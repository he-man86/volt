## Design — bridge-refusal-review

Each section is the design for one step of `tasks.md`, written before its code. A section names the target, every
realistic option MEASURED against what is recorded (the six corpora in `packages/volt-lsp-iec/test-corpus`, the
conformance recordings, DIALECT rows), the choice, what stays refused by name, and how today's code migrates.

---

## Step 4a — D3–D7: call targets, scope names, body language

Tasks 4.3 (D3), 4.4 (D4), 4.5 (D5), 4.6 (D6), 4.7 (D7). They are designed together because they are two questions:
**"what is this call head?"** (D3, D4, D5: `NetworkScope`) and **"what language is this body?"** (D6, D7:
`BodyFormatGuard`).

### How it was measured

A scratch copy of `Volt.Engine` (outside the repo) with the scope's two answers switchable, run over every
network-text body in the six corpora, built the way `ModelRoundTripOracleTests` does (each project's own files as
the declarations, `SourceScopes.BodiesOf`, `NetworkScope.FromDeclarations`), plus a probe of hand-written edge cases.
For each body the model and the writer's text were compared between today's scope and each option.

| Corpus fact (six corpora) | Count |
|---|---|
| top-level POUs (`.pou`, outside `Library Manager/` and `References/`) | 457 |
| POUs whose first code line `IsCallableHeader` does not read as PROGRAM/FUNCTION_BLOCK/FUNCTION | **0** |
| network-text bodies / networks | 34 / 157 |
| instance-call sites (box with an instance) | 46 — 45 distinct heads, all typed by a function block |
| ... of those, the type is a project item / no project item (library: `TON`, `R_TRIG`, `L_FECA.L_ReadErrorFromFile`, `rtclk.GetDateAndTime`, ...) | 19 / 26 |
| function-call sites (box, no instance) | 454 — operators (`AND`, `MOVE`, `GT`, ...), library functions (`DELETE`, `REPLACE`, `TO_STRING`), `EXECUTE`, and 26 distinct project POUs |
| heads typed by an elementary type, a DUT, an interface, a FUNCTION or a PROGRAM | **0** |
| variables named `R_EDGE`, `F_EDGE` or `PARALLEL` (corpora and conformance fixtures) | **0** |
| bodies stated `IMPLEMENTATION ST` / `LD` / `FBD` / `... UNSUPPORTED` | 2089 / 26 / 8 / 17 |

Probe (one statement, three scopes: A = today; B = every called variable is an instance; B' = the choice below):

| Declaration, statement | A (today) | B | B' |
|---|---|---|---|
| `t1 : FB_Broken` (declaration opens `(* doc` unclosed), `t1(IN := a)` | box `t1`, **no instance** (the D3 bug) | instance `t1 : FB_Broken` | instance `t1 : FB_Broken` |
| `t1 : FB_Ok` / `t1 : TON` | instance | instance | instance |
| `k : INT`, `o := k(x)` | function `k` | instance of `INT` | function `k` |
| `R_EDGE : BOOL`, `o := R_EDGE(x)` | the edge | **refused** (every edge in the POU) | the edge |
| `s : ST_T` (a DUT), `o := s(x)` | function `s` | instance of `ST_T` | function `s` |
| `f : F_Calc` (a FUNCTION), `o := f(x)` | function `f` | instance of `F_Calc` | instance of `F_Calc` |
| `c : WCHAR`, `o := c(x)` | instance of `WCHAR` | instance | instance |
| `r : REFERENCE TO TON`, `r(IN := a)` | function `r` | instance of `REFERENCE` | function `r` |
| `a,` / `t2 : TON` (list wrapped over two lines), `a(IN := b)` | function `a` | function `a` | function `a` (D5 fixes it) |

Over the corpora, A, B and B' give the **same model and the same text for 34 of 34 bodies**: no body in the corpora
depends on reading a callee's header. The options differ only on shapes the corpora do not hold.

### D3 — FB or FUNCTION, without a header

**Target.** `NetworkScope` asks no callee's text whether it is a FUNCTION_BLOCK. `IsCallableHeader`,
`CallableHeader`, `IsFunctionBlockType`, `FunctionBlockHeader` and the scope's `HeaderLine` calls are deleted
(ratchet → 0). An FB whose declaration does not parse is still called as an instance (spec, "callee whose header does
not parse").

**Where the answer is used.** Two places, and only two. `IsPou(name)` feeds one rule: a POU named like a construct
word (`R_EDGE`, `F_EDGE`, `PARALLEL`) makes `R_EDGE(…)` mean two things (`NetworkSpelling.ConstructTaken`).
`InstanceType(head)` decides whether `t1(…)` is an instance box (type from the declaration) or a function box named
`t1`.

**Options.**

1. *The IDE's POU type, carried on the declarations* (the task's wording; DIALECT C2g/C2h). CODESYS answers through
   the precompile signature (`GetPrecompileContext(app).GetSignature(guid).POUType`, current with no build, C2g);
   TwinCAT through the Solution Explorer caption only (`X (FB)`, out of process, 73–142 ms per read, C2h/C2i). Its tree
   code says function block for every POU Volt creates, until a reload (C2f, C2m). **Measured against:** (a) a POU the
   same push creates has no IDE answer until it is written. A whole-project push (the corpus-migration gate) has 19
   project-FB instance sites whose callee arrives in the same push. Each would depend on op order, and
   `PushService.DeclarationsIn` exists because op order is no contract. (b) The D3 case itself has no IDE answer
   either. A declaration that opens with an unclosed `(*` declares nothing: CODESYS answers `POUType=None` (C2g, C2j)
   and TwinCAT gives a bare caption (C2h). The caller's push would then be refused for the callee's text, which is a
   code check on another item (rule 2). **Rejected.**
2. *B, every called variable is an instance.* IEC lets a body call a variable only when it is an FB instance (or a
   reference to one). So "a declared variable called is an instance of its declared type" is a language fact, not a
   guess. **Measured against:** a BOOL named `R_EDGE` blocks every edge in its POU. The spec requirement "a variable
   named like a construct does not block it" and `NetworkScopeTests.A_variable_named_like_a_construct_…` say it
   must not. `k : INT` builds an instance box of type `INT`, while the LSP's `instanceFb` reads that head as no
   instance (`Only_a_variable_of_a_function_block_type_is_an_instance`). **Rejected** on those two oracles; their
   premise (LSP parity, the spec) does not depend on the code.
3. *B', the head's declared type, judged by KIND and by the vendor's refused names, never by text.* (**Chosen**.)
   - `IsPou(name)`: a top-level item of that name whose kind is `pou`. That is the pushed item's wire kind, else the
     IDE's class (`ItemLookup` kind 602/603/604 → `pou`). This is the same move `15d421e57a` made for GVLs.
   - `InstanceType(head)`: the type `T` the head's declaration states (`TypeOfCallTarget`, unchanged). It is an instance
     unless `T` names a top-level item of another kind (a DUT, an interface, a GVL), or `T` is a word the vendor
     refuses as a POU name (D4). A project POU of any kind, or a type the project does not hold (a library type), is an
     instance.

**Choice: 3.** It answers D3 (probe row 1). It keeps every recorded and pinned answer: the corpora give 34/34
identical bodies, and `NetworkScopeTests` keeps its rows for `INT`, `Bool`, `STRING(80)`, `ARRAY`, `POINTER`, the DUT,
`TON` and `FB_Motor`. It reads only facts the push already holds: the wire kind and the measured name list. One
answer changes: a variable typed by a project FUNCTION or PROGRAM (`f : F_Calc; f(x)`) becomes an instance box of
`F_Calc`, where it was a function box `f`. Neither compiles. The box is what the text says (a call of the variable
`f`), and the build reports it, so this is no refusal and no guess. Corpora: 0 occurrences. The LSP is not touched
(it judges the text, not the box).

**Spec.** The scenario "callee whose header does not parse" says "from the IDE's POU type". It is reworded in the step
that implements this: "built as an FB instance of the variable's declared type; no callee header is read". Option 1
shows why: the IDE has no POU type for that text either.

### D4 — an unknown call-target type

**Target.** `NonBlockTypeWords` (a hand copy of IEC types above the seam) is deleted.

**Options.**

1. *Refuse a type that neither the project nor a library names* (the task's wording). Pushing needs the library POU
   names. CODESYS has them only after a precompile: `AllPrecompiledSignatures` measured 2 signatures before a build
   and 5220 after (`CodesysObjectModel.Libraries.cs`). So every push with a graphical body would build the
   application, which is a side effect and minutes of cost. And the refusal's only reason is "the IDE would report this
   as a compile error", which rule 2 does not allow: an instance box of an unknown type can be written as sent. It
   would also refuse all 26 library-typed instance sites in the corpora on any vendor that cannot list library POUs
   cheaply. **Rejected.**
2. *Keep a vendor-neutral list of elementary types, completed (`WCHAR`).* **Measured against:** the name probes
   (`scripts/member-name-refusal{,-families,-verify}{,-tc}.log`) ACCEPT `WCHAR` (and `CHAR`) as a POU and member name
   on both vendors. The `cc5_reserved_keyword_names` recording shows CODESYS soft-allows `WCHAR : INT;` with a warning:
   on SP21 `WCHAR` is no type, and a project can own an FB named `WCHAR`. TwinCAT also accepts `LDATE`, `LTOD`, `LDT`,
   `LTIME_OF_DAY` and `LDATE_AND_TIME` as names, while CODESYS refuses them. A single neutral list is wrong on one
   vendor or the other. "It misses `WCHAR`" was itself a false premise. **Rejected.**
3. *The vendor's measured refused-name set* (`ICodeStore.RefusedName(Kinds.Pou, T)`; `CodesysRefusedNames` 1092
   words, `TcRefusedNames`, generated from the live probes). **Chosen.** If the IDE refuses a word as a POU name, no
   project and no library can hold an FB of that name. That is a vendor fact, stored as data below the seam, already
   pinned by `RefusedNamesMatchTheLogsTests`. It holds every word `NonBlockTypeWords` held on CODESYS. On TwinCAT it
   drops exactly the five words TwinCAT measurably accepts. A type the IDE does not refuse and the project does not
   hold is a library type. It is an instance, and its box is written as sent. If no such type exists, the build reports
   it.

**What stays refused.** No new refusal. If TwinCAT cannot BUILD a box whose type no tree item or library resolves
(C2m: its graphical layer takes pins from the callee), that is a vendor limit. It is unmeasured. The step records it
live on both vendors (fixture `network_unknown_fb_type`, one recorder batch). CODESYS writes it (N21: the box holds the
parameters Volt appends). If TwinCAT refuses, the driver names the IDE's refusal as UNSUPPORTED. If it takes the box,
the build error is the answer and the LSP's unknown-type diagnostic is checked against it.

### D5 — the scope's names

**Target.** The names and types a body resolves against still come from the declaration text. The push writes that
text and the IDE compiles that same text, and a box's type is needed to perform the write: the text deliberately does
not repeat it. Since 1.3, 2.10 and 2.11 no refusal rests on the scope's name set. What remains is that the one-line
`VarLine` regex misreads three shapes.

**Options.** (1) *From the IDE*: CODESYS's signature lists a POU's variables (C2g). TwinCAT exposes no project item's
signature (C2h), and a pushed item has no IDE answer until it is written, the same two failures as D3 option 1.
**Rejected.** (2) *Keep `VarLine`*: in the probe, a name list wrapped over two lines (`a,` / `t2 : TON;`) loses `a`, so
`a(IN := b)` silently becomes a function box `a`. `g5 AT %IX0.0 : BOOL;` and a one-line block
(`VAR_INPUT x : BOOL; END_VAR`) are also lost. In the corpora these shapes reach no call head (all 454 function sites
are operators, library functions or project POUs), but wrapped lists are common in declarations (hundreds per corpus).
**Rejected**: a miss writes the wrong box without a word. (3) *Read the declaration by STATEMENT*. **Chosen.** Take the
code `CodeHelper.CodeOn` already gives (comments and pragmas stripped) and join it up to each `;`. Drop the VAR-section
keywords (`VAR*`, `END_VAR`, `CONSTANT`, `RETAIN`, `PERSISTENT`). Read `name {, name} [AT address] : type`. This is
cheap (one method) and replaces `VarLine` for both `DeclaredNames` and `TypeOfVariable`, so the two stay one rule.
`REFERENCE TO T` keeps reading as the word `REFERENCE`, which the vendor refuses as a name, so it is no instance
(probe row; corpora: 0 references called). Writing it as an instance of `T` needs a measured box shape. That is
**niche: accepted loss (0 occurrences in the corpora)**, recorded as a known divergence if a fixture ever pins it.

### D6 — the live body's language as a fact

**Target.** `BodyFormatGuard` reads no body text to learn its language. `ShapeOf` and `LanguageOf` go.

**Today.** The driver knows the language as a fact. CODESYS knows it from the aspect class plus `DefaultViewMode`
(`NetworkText.ViewLanguage`, `UnreadLanguage`), TwinCAT from its archive. The driver encodes that fact into the text:
no line for ST, `IMPLEMENTATION LD|FBD` for network text, `IMPLEMENTATION <LANG> UNSUPPORTED` for a hidden body. The
guard then decodes it again with `NetworkText.Is` / `ImplementationMarker.IsUnsupportedBody`. This works only because
every reader keeps the encoding lossless: `ImplementationMarker.RequireStBody` refuses a live ST body whose text holds
a keyword-shaped line, in the CODESYS driver, the TwinCAT driver and `FakeIde`, three copies of one invariant.
Measured: in 2089 + 26 + 8 + 17 corpus bodies the decode agrees with the stated line by construction. No disagreement
exists to find. The defect is structural: the fact travels through a text encoding, three places must keep that
encoding lossless, and one that forgets makes the guard misjudge silently.

**Options.** (1) *Keep decoding*: as above. **Rejected.** (2) *Ask the driver per body at guard time*: an extra IDE
round trip per body site, although `ReadContent` already read the aspect for the same snapshot (the reason
`PushService` reads `live` once). **Rejected.** (3) *Carry it on the record*: `ItemContent`, `Member` and `Accessor`
gain `Stated`, the body's stated language as the line states it (`Language`: `ST`, `LD`, `FBD`, or a hidden body's
`CFC`/`SFC`/`IL`/vendor word; `Hidden`: whether Volt shows it), or null where there is no body. The driver's
`ReadBody` sets it from the vendor fact it already holds, and `StReader` sets it from the line it already parses.
Like `Unsupported` it is not content: nothing hashes it, and the version is the file's. **Chosen.**

**What stays refused.** `RequireStBody` stays. The FILE still needs it (an ST body whose text holds the keyword line
would read back as another language), but the guard no longer depends on it.

### D7 — one language-change comparison

**Target.** One comparison, in `BodyFormatGuard`, pre-flight. It compares `live.Stated` with `pushed.Stated` (D6).

**The facts.** DIALECT N24 (live, 3.3/3.4): CODESYS changes an existing body's language IN PLACE
(`IPOUObject.Implementation` is writable; a freshly constructed `STImplementationObject` / `NWLImplementationObject`
took the driver's own text and network writes, which built and RAN; same guid). TwinCAT has no in-place route. ST over
an archive is refused by the IDE ("Data at the root level is invalid"). An archive over ST is stored as ST text that
does not compile (104 errors). N23: the view (`DefaultViewMode`) is written on both vendors.

**Options.**

1. *Refuse ST ⇄ LD/FBD on both vendors* (today's guard; the task's "same on both vendors"). **Measured against
   N24:** CODESYS can perform the write, so on CODESYS this is Volt's own refusal, which rule 1 does not allow.
   **Rejected.**
2. *TwinCAT through the archive round trip* (export, rewrite `<Implementation>`, delete, import: `TcItemArchive`).
   That RECREATES the object, which loses its identity. Losing identity is the engineer's call (the same reasoning as
   the re-type refusal in `PushService`). It is unmeasured for a language change. **Rejected.**
3. *One comparison; the vendor answers whether it can write it.* `BodyFormatGuard` decides when a body changes
   language (ST ⇄ LD/FBD; never for a hidden body) and asks `ICodeStore.RefusedLanguageChange(site, from, to)`. That
   returns the vendor's reason or null, the same pre-flight-predicate shape as `RefusedName` / `RefusedMemberCreate`,
   and the driver's write asks the same predicate, so the two cannot disagree. CODESYS returns null and writes the
   change: it swaps the aspect inside `GetObjectToModify`/`SetObject` (N24), then runs the existing text or network
   write and the view (N23). TwinCAT returns N24's reason as UNSUPPORTED, naming the route that exists: delete the body
   and push it again. **Chosen.** The wire stays byte-identical wherever both vendors can write. The one asymmetry is a
   measured vendor limit, recorded in N24, which is what the parity rule allows (DIALECT is its census).

**Unmeasured, measured first in the step.** N24 swapped a POU's own body. CODESYS METHOD, ACTION, TRANSITION and
property-accessor bodies are separate objects. The step extends `probe-body-language-change.py` to each before the
CODESYS predicate answers null for them. Until a site is measured, the predicate refuses it UNSUPPORTED by name ("not
measured on this vendor"), and N24 gains the rows.

**What stays refused, by name, on both vendors (UNSUPPORTED, pre-flight):** a hidden body stated in another hidden
language. An UNSUPPORTED line over an ST body. An edit over a hidden body. A hidden body on a create
(`RequireAuthorable`). On TwinCAT: ST ⇄ LD/FBD on an existing body. The two accepted no-ops stay: a hidden line pushed
back unchanged, and a network body pushed as its own hidden line.

### Migration

1. **D6 first** (D7 builds on it). Add `Stated` to `ItemContent`/`Member`/`Accessor`. Set it in
   `CodesysDriver.ReadBody`, the TwinCAT body read, `FakeIde`, and `StReader` (from the parsed line). Then
   `BodyFormatGuard.Check` takes `(what, liveStated, pushedStated)`, and `ShapeOf`, `LanguageOf` and `Saw`'s text
   sniffing go. Tests first: a live body whose text is ST but whose `Stated` says FBD is judged FBD (red today).
2. **D7.** `ICodeStore.RefusedLanguageChange` on both drivers and `FakeIde` (a configurable predicate, so the engine
   tests cover both answers). Add the CODESYS aspect swap in the content write. Run the member measurements (above) in
   ONE CODESYS session, and record N24's new rows. The `GraphicalChildGuardTests` / `BodyFormatGuard` rows that expect
   a CODESYS refusal are rewritten: their premise (no in-place route) was disproved by N24, a measurement independent
   of the code. TwinCAT's rows stay. Negative e2e on TwinCAT and positive e2e on CODESYS (§8), instance
   `bridge-refusal-review`.
3. **D3 + D4 + D5 together** (one scope change). `PushedDeclarations` keeps every item's wire kind by name, not only
   the GVL set. `ProjectDeclarations` exposes the kind of a name (pushed first, then the IDE index) and takes the
   driver's refused-POU-name predicate. `NetworkScope.FromDeclarations` takes `kindOf` and `isRefusedPouName` instead
   of reading headers. `StDeclaration` loses `IsCallableHeader`, `CallableHeader`, `IsFunctionBlockType`,
   `FunctionBlockHeader` and `NonBlockTypeWords`, and its `VarLine` becomes the statement reader. Set the
   `NoCodeCheckLeftTests` counts to 0 for `IsCallableHeader`, `IsFunctionBlockType`, `FunctionBlockHeader`,
   `NonBlockTypeWords` and "HeaderLine outside CodeHelper" in the same commit. Tests first: the unclosed-`(*` callee is
   an instance (red today); `a,`/`t2 : TON` wrapped, `g5 AT %IX0.0 : BOOL` and a one-line `VAR_INPUT` are named (red
   today); `LDT` as a type is an instance on TwinCAT and no instance on CODESYS. The existing `NetworkScopeTests` rows
   keep their expectations and gain only the two new arguments. Record `network_unknown_fb_type` on both vendors in
   one batch. Reword the spec scenario.
4. The corpus oracle (`ModelRoundTripOracleTests`, 34 bodies / 157 networks) must stay at its pinned tallies. The
   scratch measurement above predicts no change.
