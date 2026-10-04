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

### As built (step 4a) — where reality forced a different choice, and why

- **D7 runs at the item's guard, not in the batch pre-flight.** The comparison needs the LIVE body's language, which only
  a `ReadContent` of the item gives. The batch pre-flight reads the project in ONE walk and no item (a per-op lookup was
  measured to take the live TwinCAT suite from ~5 to over 20 minutes, `PushService.WillCreate`), and a per-op content read
  costs more than a lookup. The apply loop already reads `live` once per item for the guard, the reconciler and the write
  filter, so the comparison runs there — before the item's FIRST write, so a refused change writes nothing of that item;
  an earlier op of the batch that landed is reported as landed (push-keeps-what-landed). "Pre-flight" in the task reads as
  "before the write", which this holds.
- **The member sites were measured live, and all write.** `scripts/probe-member-language-change.py` (its own script and
  log, so N24's `body-language-change.log` stays the record of the POU case): a METHOD's, an ACTION's, a GET's and a SET's
  body each took a fresh aspect of the other language in both directions, same guid, built clean and ran. CODESYS answers
  null for those five sites (POU, method, action, property_get, property_set); any other site is refused by name. No
  site stays "not measured".
- **The CODESYS swap rides the write's own transaction.** `WriteSourceText(…, newBodyAspect)` and `WriteGraph(…, aspect)`
  put the fresh aspect on the checked-out object and write into it before the one `SetObject`, so a write that fails rolls
  the swap back with it and the old body stays. N24 measured the swap and the write in two transactions; the single
  transaction is measured by the live e2e (`graphical/language-change.test.ts`: a POU ST → LD → ST and a method
  ST → FBD → ST, each pulled back and built clean on CODESYS; refused untouched on TwinCAT).
- **`Stated` is null exactly where there is no body text** (D6), on both vendors: TwinCAT stores an empty ST body as no
  text, so neither driver states a language for an empty body, and the guard reads "no live text" as an empty ST body —
  every graphical and hidden body has text (its keyword line). A body WITH text and no stated language is refused loud
  (`InvalidOperationException`): a reader that forgot the fact. The CLI's `SameBody` asks no kind and no refused name (it
  holds no project and links no driver); it reads both texts in one scope, so they read alike.
- **D4's unmeasured TwinCAT limit is measured: there is none.** `network_unknown_fb_type`, recorded on CODESYS SP21 and
  TwinCAT Project13 in one batch each: both write the box and both builds answer the same two errors (`Unknown type:
  'FB_LANG_NoSuchType'`, `Program name, function or function block instance expected instead of 't1'`; DIALECT N26). No
  refusal; the LSP flags the source as the build does (rating `refused`).
- **`CodeHelper.HeaderLine` is deleted** with its last product caller (the repo gate `NoTestOnlyCodeInSrcTests` named it
  test-only). The test double reads a fixture's first code line through `CodeOn` itself.
- **D5's statement reader reads through `StTrivia`**, not `CodeOn`: comments nest, a comment opened after code on its line
  is seen, and string text is blanked — so a trailing `// …` or `(* … *)` is no part of the next statement. The corpus
  oracle stayed at its pinned tallies.

---

## Step 4b — D8–D12: one validation, no content scans, a signature without vocabulary, one shape table

Tasks 4.8 (D8), 4.9 (D9), 4.10 (D10), 4.11 (D11), 4.12 (D12). They are one step because each removes a second reading
of something the push has already read once: the network body (D8, D12), the boundary line (D9), the member header
(D10), and the kind's shape (D11).

### How it was measured

A scratch console outside the repo, linked against a Release build of `Volt.Engine` at HEAD (`0bc065950c`), ran over
the six corpora the way `ModelRoundTripOracleTests` harvests them (each project's own files as the declarations,
`SourceScopes.BodiesOf`, `NetworkScope.FromDeclarations` with `BothVendorsRefusedNames`). Line counts are `grep` over
every `.pou`/`.dut`/`.gvl`/`.itf` of the corpora (16,990 / 8,175 / 1,296 / 2,709 files, libraries included). The kind
table below was read off the code.

| Corpus fact | Count |
|---|---|
| top-level POUs outside `Library Manager/` and `References/`; `StReader.Read` over all of them | 457; 334 ms (0.7 ms each) |
| network-text bodies; `NetworkTextGate.Validate` over all of them | 34; 211 ms, median 2.2 ms, max 49.6 ms (the first, JIT) |
| bodies whose model and canonical text are identical when read twice against two scopes built independently, the first model written against the second scope | **34 / 34** |
| lines of the keyword's SHAPE (`ImplementationMarker.Shape`) | 2,140 — every one a valid boundary line (2,089 `ST`, 26 `LD`, 8 `FBD`, 17 `… UNSUPPORTED`) |
| shape lines that are NO boundary line (bare `Implementation`, `Implementation OR b`, `IMPLEMENTATION COBOL`, code after the language) | **0** |
| other occurrences of the word `implementation` | 28, all inside comments |
| empty POU files / POU files outside libraries without a boundary line | 0 / 0 |
| METHOD / PROPERTY / ACTION signature lines | 55,607 + 202 + 46 bare; 1,420 with modifiers |
| modifier words seen | `PUBLIC` 883+, `PROTECTED` 351, `PRIVATE` 163, `INTERNAL` 11, `FINAL` 7, `ABSTRACT` 13 — all six of `Modifiers`, always BEFORE the name |
| signature lines with a word between keyword and name that is not one of the six | **0** |
| ACTION lines holding anything besides the keyword and a name (modifier, type, comment) | **0** / 46 |
| `ACTION` blocks inside an interface | 0 / 2,709 |

From the measured name lists (`BothVendorsRefusedNames`, `CodesysRefusedNames`, `TcRefusedNames`): all six modifier
words are refused as a member name by BOTH vendors, so no member can be named by one.

### D8 + D12 — each network body validated once, and the write takes the model

**Target.** One `NetworkText.Validate` per network body per push, in the engine's pre-flight. The drivers' writes take
the model and the scope it was read against; they hold no copy of the validation and parse no body text. The create
arm's copies (`PushService.cs:1261` `NetworkText.Validate`, and `WriteItemFromSource`'s second `StReader.Read`) go.

**Today.** Counted per body per push, from the code:

| Path | `StReader.Read` | `NetworkText.Validate` |
|---|---|---|
| update (item body or member body) | 2 (pre-flight, `WriteItemFromSource`) | 2 (pre-flight, driver write) |
| create: the item's own body | 2 | **3** (pre-flight, create arm, driver write) |
| create: a member's body | 2 | 2 |
| move + edit | 3 (pre-flight, two `WriteItemFromSource`) | 3 (pre-flight, each write) |
| replace (forced over an unopened item) | 2 | 3 |

The TwinCAT pre-flight (2.27) already takes the engine's models and lowers each CREATED body once
(`TcPlcOpenWriter.WriteProject`, a throwaway). That is a lowering, not a validation; the write lowers again because
that is the write.

**What the measurement says.** The repetitions cannot disagree today. The readings are deterministic (34/34), and all
of them ask the same `ProjectDeclarations` instance, which only `WalkItems` drops; nothing in a push walks between
the pre-flight and the receipt. The three body/scope pairings agree too: `SourceScopes.SitesOf`, CODESYS
`WriteMembers`/`WriteAccessor` and TwinCAT `Collect` all take the member first, then the owner, and an action against
its owner's alone. The cost is negligible: ≤ 0.5 s on a whole-corpus migration, against IDE writes that take
minutes. So the defect is **structural, not a bug or a cost**:
- four places pair a body with its scope and validate it;
- a refusal raised from the driver's copy is unreachable behind the pre-flight, and only a test that calls
  `WriteContent` directly can reach it;
- the `NetworkTextSwitch` guard relies on every copy staying in place.

**Options.**

1. *Keep it, document the determinism.* The four pairings stay four places to keep in step. **Rejected.**
2. *Memoize `NetworkText.Validate` by text and scope.* Scopes are rebuilt per call, so an identity cache misses, and
   a value cache would need scope equality. It hides the copies instead of removing them. **Rejected.**
3. *The model on the record* (`ItemContent`/`Member`/`Accessor` gain `Graph`, like D6's `Stated`). A `with` that
   changes the text keeps the old model. `PushService.cs:1375` writes `split with { Body = null, Members = [] }`, so
   a stale root model would ride along: text and model disagree without a word. **Rejected.**
4. *The validated bodies beside the content* (**chosen**), the shape `ICodeStore.ValidateSource` already takes.
   - `PushedNetworkBody` gains the `NetworkScope` it was read against: `(BodySite Site, NetworkBody Model, NetworkScope Scope)`.
   - `ValidateSourceOrThrow` returns a `ValidatedSource(ItemContent Content, IReadOnlyList<PushedNetworkBody> Bodies)`,
     and the pre-flight keeps one per set op.
   - The apply loop, `ApplyOp`, `WriteItemFromSource`, `MoveItem` (both of its writes) and the replace arm take that
     instead of `string src`.
   - `ICodeStore.WriteContent(ItemRef item, ItemContent content, IReadOnlyList<PushedNetworkBody> bodies)` drops
     `PushedDeclarations`. Every driver use of it built a network scope, and the scope now travels with its model.
   - At each network-text body it writes, the driver takes the model and scope for that site:
     `CodesysNetworkWriter.Write(iobj, model, scope)`, TwinCAT `ResolveBody(existing, model, scope)`.
   - A network-text body with no entry is **Volt's bug**: `InvalidOperationException` naming the site. A body the
     write does not touch (`OnlyChanged`, a declaration-only write) is never looked up. Nothing is guessed or defaulted.

**Choice: 4.** It closes D8 and D12 together: each body is validated once, by the engine, on both vendors.
`NetworkScopeFor` stays on the driver for the pre-flight and for pull (`ScopeForPull`). The TwinCAT pre-flight
lowering stays: it asks the model the vendor's "can this be created" question (D21), not the text.

**What stays refused.** Every `NETWORK_*` refusal, raised once and before the first write, with its code and line. The
`NetworkTextSwitch` refusal stays in `NetworkText.Validate`, now its only door; a driver cannot write a model that did
not pass through it. No new refusal.

**Gate.** `NoCodeCheckLeftTests` gains a ratchet: `NetworkText.Validate(` appears exactly once in product source (the
pre-flight). Tests:
- A `FakeIde` write handed a network body with no model throws, naming the site. Red until the drivers stop
  validating.
- A CODESYS and a TwinCAT write whose `ProjectDeclarations` throws when asked still writes the model it was handed.
  That proves there is no second reading.
- A move + edit and a create each validate once (a counting scope source on `FakeIde.NetworkScopeFor`).
- Tests that call `WriteContent` directly build their bodies through the engine helper the pre-flight uses
  (`SourceScopes.Validated(content, scopeFor)`).

### D9 — the boundary line by its grammar alone; one refusal for a text with no outer block

**Target.** A line is a body's boundary only when it IS one (`ImplementationMarker.Is`: the keyword, one word,
optionally `UNSUPPORTED`, as `Parse` accepts). Any other line is code. The SHAPE (`Shape`, `Stated`) is read in one
place only: as the HINT of the no-boundary refusal, the way 2.1 kept the retired comment. The empty-text branch
(`StReader.cs:111`) goes.

**Today.** `Shape` makes every line that opens with the keyword and a word a boundary candidate. So `Implementation`
on its own line, or `Implementation OR b;` in a wrapped expression, is refused on push (as a second boundary,
`SplitAtBoundary`, or as a line in a declaration, `RefuseLinesInDeclarations`), refused on pull (the drivers'
`RequireStBody`), and mirrored in the LSP (`implementation-line.ts` `SHAPE`). That is a code check: CODESYS compiles
`x := a OR\n  Implementation;` with `implementation : BOOL;` declared (1.2 recorded that the identifier compiles).
Separately, the empty-text message is wrong for an interface: it says the file "holds at least its declaration, its
IMPLEMENTATION line and its END line", and an interface has no such line.

**Options.**

1. *Keep `Shape`.* **Rejected**: it refuses code the IDE compiles (rule 2).
2. *`Shape` minus the bare keyword* (4.9's wording). Passes `Implementation`, but still refuses `Implementation OR b`
   and every `IMPLEMENTATION <word> <more>` continuation. **Rejected** as half the same check.
3. *Grammar only* (**chosen**). `StatedLinesIn`, `IndexIn`, `RequireStBody` and `RefuseLinesInDeclarations` ask
   `Is`. Once only a valid line can be the boundary, `Body()`'s lookalike refusals are unreachable, so they become the
   `Unmarked` hint: a line stating no language, a bare `IMPLEMENTATION CFC|SFC|IL` (section 2b's line, "pull
   again"), a word no body states. The hint names the first line outside comments that opens with the keyword, and
   what it lacks. A file that forgot its language is still refused, by name, with the same advice.

**Choice: 3.** It changes the verdict on **0 of 2,140** corpus shape lines, removes one regex and three refusal arms,
and holds no code check: every line still refused is one the format cannot hold. The LSP's `SHAPE` changes in the
same step, because it reads the same file format and an LSP-only report is a false positive. That is row (e) of 5.2,
done here. 4.9's test: an ST body holding `Implementation` (and `Implementation OR b`) pulls and pushes as written.

**Empty text.** The branch goes. An empty or blank POU or interface text has no outer block, so it gets the refusal
every text without one gets: `FindOuterBlock`'s "Missing END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION in 'X'"
(END_INTERFACE for an interface). One condition, one message, right for both composite kinds. `Unmarked` stays the
refusal for a text WITH an outer block and no boundary: two conditions, two messages. Corpora: 0 empty files.

**What stays refused, by name.**
- Two valid boundary lines in one region: the text cannot say which.
- A valid boundary line inside a declaration: it would read back as the boundary.
- Code under an `UNSUPPORTED` line.
- A `%FOLDER` line out of place.
- A region with no boundary line (`Unmarked`, now with the lookalike hint).
- An ST body in the IDE holding a valid boundary line (`RequireStBody`).

### D10 — the member header: the name is the last word before the colon

**Target.** `ParseSignature` returns the name and the type text, with no modifier vocabulary (2.5). The type
requirement and the ASCII check are gone already (2.4, 2.6, 3.1), and the TwinCAT interface-member seed lives in that
driver (2.4).

**Options.**

1. *Keep `Modifiers`.* The six words are a fact: both vendors refuse each as a member name, and the corpora hold no
   other word there. But refusing a seventh word (`METHOD PUBLC Run : BOOL`) is still a code check: the IDE takes
   that text as the declaration of the method `Run`, and its build reports the word. **Rejected** (rule 2).
2. *The first word that is not a modifier is the name; later words pass through.* A modifier typo,
   `METHOD PUBLC Run`, reads as the member `PUBLC`; on an update that deletes `Run` and creates `PUBLC`, and the
   method loses its identity silently. Modifiers stand before the name in 1,420 of 1,420 corpus signatures, so a
   modifier typo is the realistic typo. **Rejected.**
3. *The last word before the colon is the name* (2.5; **chosen**). A modifier typo keeps the member:
   `METHOD PUBLC Run` is `Run`, and the build reports `PUBLC`. Review 1+2d's case, `METHOD Run Walk : BOOL` over an
   existing `Run`, reads as `Walk`. That is a member renamed by its header, which is what every header rename already
   is (the reconciler deletes and creates, `PushService.ReconcileMembers`); the stray word is the build's to report.
   Pull reads member names from the IDE's objects (`MemberSites.Of`), so the round trip is stable: object `Walk` with
   header `METHOD Run Walk` reads back as `Walk`. A name the vendor refuses (`METHOD Run PUBLIC`) is refused by the
   pre-flight's `RefusedName` before anything lands. Corpora: 0 lines read differently from today.

**Found while measuring, and fixed here.** An ACTION's line is composed, not stored: CODESYS writes an action no
declaration (`WriteMembers`: `Action ? null`), and TwinCAT composes `ACTION <name>` (`MemberDeclaration`). Today
`ACTION PUBLIC Run` accepts the modifier and **drops it without a word**, and a comment on that line goes the same
way. So the ACTION line is refused by name (INVALID_ST) when it holds anything besides the keyword and a name: a
modifier, a type (today's ":" refusal joins it), or a comment. The message: "an action has no declaration the IDE
stores; this would be dropped". This is needed-to-write, measured on 0 of 46 corpus action lines.

**What stays refused.**
- A signature with no name (`METHOD : BOOL`).
- An END line read where a name should be. `RefuseEndAfterCode` runs before the signature is read, and
  `ChildSplitterTableTests` keeps its two rows.
- The ACTION line above.
- A name a vendor refuses (pre-flight, UNSUPPORTED).

**Recording.** One batch per vendor in this step's recorder run: fixture `sig_unknown_word` (an FB with
`METHOD PUBLC Run : BOOL` and `METHOD Run Walk : BOOL`), plus the build error for 2.4/2.5's `METHOD Run :`. The LSP
reports what is recorded (5.1/5.2). `SignatureParseTests`' refusal rows (STATIC, FOO, PUBLIK) are rewritten to assert
the name and type read; their premise was the vocabulary this step removes. Rows for the ACTION refusal are added.

### D11 — one shape table per kind

**Target.** "What a kind's file holds" is answered by one table on `ItemKind`, and every reader, writer and guard asks
it. `BodyFormatGuard`'s `InterfaceMethod` branch (:57, :100) is fixed by the table, not by a third kind list.

**Today: one question, five spellings, three disagreements.**

| Spelling | pou | interface | gvl/dut | method / action | property | interface_method | interface_property |
|---|---|---|---|---|---|---|---|
| `ImplementationMarker.AppliesTo` (and `NetworkText.CanHold`) | T | F | F | T | **T** | F | F |
| `StWriter.HasBody` | T | **T** | F | — | — | — | — |
| `StReader` `Gvl or Dut` (×3), `OuterEndKeywords`, `kind == Interface` | split | split, inside | as sent | — | — | — | — |
| `BodyFormatGuard.CarriesAccessors` | — | — | — | F | T | **T** | T |
| `CodesysDriver.ReadMember`, `PushService:1735` (accessors read / reconciled) | — | — | — | F | T | F | T |

Each bold cell is one word made to carry a different meaning:
- `AppliesTo(property)` is true because a property's ACCESSORS carry the line, not the property.
- `HasBody(interface)` means "composite".
- `CarriesAccessors(interface_method)` means "has no body"; an interface method has no accessors.

TwinCAT's `HasBodySlot` is a sixth spelling, but it is a vendor question about an OBJECT. D26 (4.26) replaces it by
asking the object, so it is not folded into this table.

**Options.**
1. *Five named predicates on `ItemKind`*: one file, but the sets can still contradict each other.
2. *A kind object hierarchy*: more machinery than six facts need.
3. *One row per kind* (**chosen**): `ItemKind.ShapeOf(kind)` returns
   `KindShape(bool Composite, bool MembersInside, bool Body, AccessorShape Accessors, bool Signature)`. It is a total
   switch, and an unknown kind throws as Volt's bug (ArgumentException → INTERNAL_ERROR, as 2.2).

| kind | Composite | MembersInside | Body (IMPLEMENTATION line) | Accessors | Signature (create takes a type) |
|---|---|---|---|---|---|
| pou | T | F | T | none | F |
| interface | T | T | F | none | T |
| gvl, dut | F | — | F | none | F |
| method, action, property_get, property_set | F | — | T | none | F |
| property | F | — | F | with bodies | F |
| interface_method | F | — | F | none | T |
| interface_property | F | — | F | declarations only | T |

**Who asks it.**
- `ImplementationMarker.AppliesTo` → `Body`.
- `StWriter.HasBody` → `Composite`.
- `AssembleChild`/`AssembleProperty`'s `marked` → `Body` / `Accessors == WithBodies`. The owner check goes, because
  interface members are kinds of their own.
- `StReader`'s three `Gvl or Dut` returns and its interface branch → `Composite` / `MembersInside`. The END words stay
  the reader's text vocabulary, keyed by kind.
- `NetworkText.CanHold` → source kind and `Body`.
- `BodyFormatGuard` checks accessors where `Accessors != none` and the body where `Body`, and skips a kind with
  neither. That is the `InterfaceMethod` fix.
- `SourceScopes.SitesOf` yields only the sites the table says exist.
- `CodesysDriver.ReadMember` and `PushService:1735` → `Accessors`; `PushService.CreateSeed` → `Signature`.

**Behaviour.** No answer changes for any kind the push reads: each disagreement was in WHICH predicate a caller asked,
not in the answer it got. A table test over every kind proves it, comparing each consumer's old predicate with the
row; it runs before the predicates are deleted. An ACTION inside an interface keeps today's path (0 occurrences in the
corpora): the reader maps it by its owner, as the IDE read does, and the vendor's create answers.

### Migration

1. **D11 first**, because D8 and D9 build on its `Body`/`Accessors`.
   - Add `KindShape`/`ShapeOf`, then the table test pinning the old predicates.
   - Point the consumers at it. Delete `AppliesTo`'s body, `HasBody`, `CarriesAccessors` and the `Gvl or Dut` copies.
   - Fix the guard's `InterfaceMethod` branch. Test: an interface method pushed over the live one checks no body and
     no accessor. Today it differs only in its reason, so the test asserts which site the guard asks.
2. **D8 + D12.**
   - `PushedNetworkBody` gains `Scope`; add `ValidatedSource`, kept by the pre-flight per op.
   - `WriteItemFromSource`/`MoveItem`/replace take it; the create arm's `StReader.Read` + `Validate` go.
   - `ICodeStore.WriteContent` changes on both drivers and `FakeIde`. Delete the drivers' write-path
     `NetworkText.Validate`/`NetworkScopeFor` calls (CODESYS `:61`, `:441`, `:542`; TwinCAT `:241`, `:384`, `:446`).
   - Regenerate `docs/assets/data.js` (the driver-interface row) and add the ratchet. Tests first (above).
3. **D9.**
   - `StatedLinesIn`/`IndexIn`/`RequireStBody`/`RefuseLinesInDeclarations` ask `Is`, and `Body()`'s lookalike arms
     move into `Unmarked`'s hint.
   - The empty-text branch goes.
   - The LSP `SHAPE` change and its src test land in the same commit.
   - Tests first: an ST body with `Implementation` / `Implementation OR b` pulls (CODESYS and TwinCAT reader doubles)
     and pushes; `IMPLEMENTATION SST` alone is refused `Unmarked`, naming the line; an empty interface is refused
     "Missing END_INTERFACE".
4. **D10.**
   - `Modifiers` goes: the name is the last word. Add the ACTION-line refusal.
   - Record `sig_unknown_word` on both vendors, one batch each, and rate it with `rate:fixtures`.
   - Rewrite the `SignatureParseTests` rows (their premise was the removed vocabulary).
5. The corpus oracle (34 bodies / 157 networks) stays at its pinned tallies. The scratch measurement predicts no
   change: 0 corpus lines read differently under D9 or D10, and D8 changes no model (34/34).

### As built (step 4b) — where reality forced a different choice, and why

- **D11: the writer keeps one owner question, asked of the owner's row.** "The owner check goes" holds for every kind
  of its own (`interface_method` and `interface_property` have no body / declaration-only accessors in the table). An
  ACTION inside an interface (0 in the corpora) is not a kind of its own: the reader splits an interface's block with
  every member a signature (`marked: false`), so `StWriter` marks a member only when the OWNER's row is not
  `MembersInside` — the same row the reader splits by, so the two cannot disagree. Asking the child's row alone would
  write an interface action a boundary line the reader then refuses as a line in a declaration.
- **D11: the ST reader asks the table only for a SOURCE kind.** `ShapeOf` has rows for members and accessors, so a
  member kind handed to `StReader.Read` would have read as a non-composite "declaration as sent". The reader keeps 2.2's
  contract (a kind no source file is → `ArgumentException`) through `ItemShape`, which admits the four source kinds.
- **D8: the push's declarations reach a body through its scope only.** `WriteContent` takes no `PushedDeclarations`,
  so `FakeIde` records what each `NetworkScopeFor` was handed (`ScopesPushed`) instead of what each write was handed;
  `PushSiblingDeclarationsTests` and `GlobalsByWireKindTests` assert there (their caller now has a network body — an ST
  body asks no scope). `WriteItemFromSource` refuses a source read under another kind than the one it lands under
  (INTERNAL_ERROR): it no longer reads the text, so it states the one fact it used to re-derive.
- **D8 proof without a throwing `ProjectDeclarations`:** the driver tests hand the write a body TEXT that does not read
  at all beside a valid model for its site (TwinCAT: under a declaration that does not even declare the archive's FB
  instance, which only the handed scope does). A driver that read the text again, or built a scope of its own, refuses;
  both write the model (`CodesysWriteTakesModelTests`, `TcWriteTakesModelTests`). Ratchet: `NetworkText.Validate(` = 1 in
  product source (`SourceScopes.Validated`).
- **D10: the END-after-code exemption keeps the six measured words — on a colon-less line only.** `ParseSignature`
  reads the name as the last word before the colon with no vocabulary. But the exemption that lets an END word stand in
  a header's NAME position runs BEFORE any name is read, and on a line with NO colon the text alone cannot tell
  `METHOD PUBLIC end_method` (a method named end_method, measured accepted, 3.G) from `METHOD Foo END_METHOD` (an END
  line where a name should be — "ChildSplitterTableTests keeps its two rows"). Without a list both read alike. So
  `HeaderNameAt` keeps `HeaderModifiers` (the six words, the list the pull's END-line mirror already holds) for that
  position only; it decides no name. With a colon on the line (review 4b) the name position is the last word before it,
  exactly ParseSignature's word, so the two never disagree: `METHOD PUBLC end_method : INT` is the method end_method
  (it was refused as "END_METHOD stands after code").
- **D10: what the build answers.** Recorded (`sig_unknown_word`, `sig_empty_type`; CODESYS SP21 and TwinCAT Project13, one
  batch each): both vendors read a member header's FIRST word after the keyword as its name and compare it with the
  object — "The name used in the signature is not identical to the object name" for `METHOD PUBLC Run` (object Run) and
  `METHOD Run Walk` (object Walk), then each vendor's recovery. So the build does not "report PUBLC" by that word; it
  reports the mismatch, which keeps the member identity Volt chose visible. `METHOD Run :` is "Type definition expected
  instead of ''" on both. The LSP matches the latter (`parse/units/header.ts`); the former is a known divergence,
  `MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD` (niche: 0 corpus signatures hold a non-modifier word before the name).
- **D10's consequences on recorded fixtures.** The five OVERRIDE fixtures (`unit_method_override`, `…_public_order`,
  `unit_property_override`, `unit_interface_method_override`, `unit_interface_property_override`) were refused by the
  push ("'OVERRIDE' is not an access modifier"); they are written now and both builds were recorded. Three became
  as-sent fixtures with their base FB a fixture of its own (the LSP parser reads OVERRIDE as the name, as the vendors
  do, so it cannot mark the units the recorder splits by). `unit_action_modifier` (`ACTION PRIVATE Act`) is now refused
  by the push, by name; its old build rows predate the refusal.
- **D10's ACTION refusal covers a `;` too** (it is dropped like a modifier or a comment); spacing between the keyword and
  the name is layout. The refusal covers the LINE, as designed. **Review 4b closed its two neighbours** (cheap, so fixed
  under the owner's triage): trivia lines ABOVE an ACTION keyword and a VAR section or comment UNDER it, before the body,
  were read into the action's declaration, which neither write stores (`Action ? null`), so the push accepted them and
  dropped them (`unit_action_var_section`: "Identifier 't' not defined"). The rule is now the declaration's, not the
  line's: an action's declaration is its ACTION line and nothing else but blank lines (`StReader.RefuseActionDeclaration`,
  naming the first other line). A pull composes `ACTION <name>` on both vendors, so no pulled file holds anything else.
- **D9 on the LSP:** `ImplementationStatement` lost its three lookalike kinds (`no-language`, `not-a-language`,
  `bare-hidden`); `opensKeywordLine` asks the grammar; the shape is read only by `lookalikeLine`, the hint of the server's
  "states no language" finding (the push's `Unmarked`). FMT8 still reports the identifier `implementation` itself — that
  is task 5.2 row (a), not this step.

---

## Step 4c — D13, D14, D20: canonical gates gone, a coded `.task` refusal, one member-kind map

**D13 — target: no canonical-form refusal left, and no comment claiming one.** Measured at HEAD: the code is done
(2.7–2.13: `NETWORK_NOT_CANONICAL` has 0 hits in `src`, `Volt.Contracts` and `packages/volt-lsp-iec`; the `.task`
gate is `Read`). The canonical text already comes back with no new field — `newSources` on the push answer (route A,
`067bc23a03`) and the next pull. Left: six comments that still state the rule — `NetworkTextReader.cs:297`,
`NetworkText.cs:28` ("the gate calls such a text not canonical"), `ICodeStore.cs:89`, `PushService.cs:139`,
`docs/driver.html:139`, and the `TaskDescriptorException` summary ("the exact text to use instead"). Choice: rewrite
them; tick V.2 (the LSP list is already empty); `NETWORK_NOT_CANONICAL` stays in the 6.2 grep gate. Rejected: an
optional `canonical` field on the push answer — `newSources` already carries the text.

**D14 — target: a refused `.task` reaches the wire as `BAD_REQUEST`, not `INTERNAL_ERROR`.** Today
`TaskDescriptorException : Exception` falls through `PushService.ConflictFor`'s `ICodedError` check to the
`INTERNAL_ERROR` default (7 throw sites, `TaskDescriptorFormat.cs:84–158`). Choice: `TaskDescriptorException :
BridgeException`, its code fixed at `BAD_REQUEST`. The type, the seven messages and the four `Assert.Throws` rows stay.
`BAD_REQUEST` is already a `FromBridge` conflict code, so the push reports it per item. Rejected: a type switch in
`ConflictFor` (a second code table); deleting the class and throwing `BridgeException` at 7 sites (churn, and it
loses the named type); `UNSUPPORTED` as V.1 suggests (a malformed `.task` is the request's grammar, not a vendor
limit — V.1's `.task` clause is amended to `BAD_REQUEST`). Also: every re-code in §2 gets a code-asserting test.
Each §2 row is checked for an `ErrorCode` assertion, and a row without one gets one.

**D20 — target: one member-kind map, no `?? ""`.** Choice: `ItemKind.MemberKind(int code, bool ownerIsInterface)` in
the Engine, moved from `CodesysDriver.Content.cs:255` (rule unchanged). The OWNER decides method-vs-interface-method and
property-vs-interface-property on both vendors. The code alone cannot decide on CODESYS: an FB property answers to
`IInterfacePropertyObject` (measured, its doc comment). IEC makes the owner the vendor-neutral fact. TwinCAT's
`ReadMember` passes its owner's code (`KindCode(item) == PlcItf`, like CODESYS `:36`) in place of `ItemKind.Map(site.Code)`.
`BeckhoffDriver.Content.cs:750` `ItemKind.Map(code) ?? ""` is reached only with `PlcPropGet`/`PlcPropSet` (the
interface pair returns at `:738`), so it becomes `?? throw BridgeException(INTERNAL_ERROR, …)`: Volt's own invariant.
Rejected: a code-only shared map (wrong on CODESYS FB properties); keeping two private maps (the duplication D20
names); trusting TwinCAT's code over its owner (two rules for one IEC fact).

**Stays refused by name:** a malformed or repeated-label `.task` (now `BAD_REQUEST`, naming line and label); a member
code with no Volt kind (`UNSUPPORTED`, naming the member and the code, both vendors); a late VAR_TEMP name already read
as a variable (`NETWORK_DUPLICATE_NAME`, 2.7).

**Migration.** Tests first, red before: an Engine table test for `ItemKind.MemberKind` (each member code × owner, plus
an unknown code refused `UNSUPPORTED`); a `PushService` test where a malformed `.task` set gives a conflict coded
`BAD_REQUEST`. Then the code: delete CODESYS's private map, point TwinCAT at the shared one, replace the `?? ""`,
rebase `TaskDescriptorException`. Then the six comments. Regenerate `docs/assets/data.js` if the code census moves.
No LSP fixture: nothing a user writes changes its answer, except the code of a malformed `.task`.

## Step 4d — D26, 4.31, 4.32: a body without a slot, a move into a non-folder, the re-type route

**D26 — target: a text sent at a slot the OBJECT lacks is refused by name, never dropped.** Today CODESYS
`SetAspectText` returns on a missing aspect (`CodesysObjectModel.cs:258`) and TwinCAT asks a kind table
(`BeckhoffDriver.Content.cs:628` `HasBodySlot`); either way the push says "updated". Choice: each object model's ONE
text write asks the object — CODESYS `GetMember(iobj, aspect) == null`, TwinCAT the COM member missing
(`TcObjectModel.IsMissingMember`, the classification `ReadImplementation` already uses) — and a non-null text at a
missing slot throws `BridgeException(UNSUPPORTED)` naming the item and the slot (`Interface` / `Implementation`), inside
the checkout so CODESYS rolls back. The declaration gets the same rule (a missing `DeclarationText` is a raw
`RuntimeBinderException` → INTERNAL_ERROR today). `HasBodySlot` is deleted: which slots a KIND has is the Engine's
`ItemKind.ShapeOf(kind).Body` and the reader already sends no body for a kind without one; if a test shows a
property arriving with `""`, the producer is fixed, not a driver table. Rejected: keep `HasBodySlot` and refuse when
it says no (still a kind table; the object is the fact); an Engine-only check (cannot see an object of a body kind
that lacks the aspect, the case that drops today).

**4.31 — target: a move whose `toFolder` lands on a node that cannot hold an item is refused before anything is
applied, and a move the IDE ignored is caught after.** Measured (`scripts/merged-classes.log` 225–229): CODESYS accepts
`Move` into `Device` / `Task Configuration` and leaves the object; `DescendOrCreateFolder` descends any non-CRUD node
by name, so `Device` resolves. Choice: (a) the pre-flight resolves each MOVE's `toFolder` read-only (as
`DescendExisting`) and the deepest existing node must be the tree root, a `PlcFolder` or an `Application` — else
`UNSUPPORTED` "'X' cannot move into '<path>': '<node>' is a <kind>, not a folder" (both vendors; the rule is the
Engine's, so TwinCAT's own answer does not decide it — still measured once with a non-folder target, a POU node, and
recorded in DIALECT); (b) `MoveItem`'s post-condition compares the re-found item's folder with the requested one and
refuses naming where the IDE left it (extends `PushService.cs:1135`, TwinCAT `BeckhoffDriver.Tree.cs:385`). The allowed
set is MEASURED first: the kind of every node that holds a source item in the corpora's live refs (Pro2193, Bakon, the
TwinCAT fixtures); a holder kind found outside the three joins the set, never a default. A CREATE keeps the vendor's
own create refusal (not in this task). Rejected: post-condition only (refuses after earlier ops landed); asking the
vendor "can move" (no measured API on either).

**4.32 — choice: STAYS REFUSED (owner may flip; default named so the step does not stall).** `deleteItem X.pou` +
`set X.dut` in one push keeps `BAD_REQUEST` from `RequireOneOpPerItem`. Why: git pairs the same edit as ONE
renaming `set` when the texts are similar, and that op is refused by the re-type guard (`PushService.cs:1426`, kept);
writing the unpaired form would make one intent succeed or fail on git's similarity score. A re-type discards the
object's identity, which is the engineer's call (as the guard says). Rejected: write it in one push (delete, drop the
bare-name cache entry, create) — asymmetric with the paired form, and a refused create after a landed delete leaves
the IDE without the object. Change: the message states the CLI remedy — commit the deletion, `volt push`, then commit
the new file, `volt push`. `OneOpPerItemTests` stay (premise unchanged); one row pins the new wording.

**Stays refused by name:** a re-type by name (single op, UNSUPPORTED, message kept); a delete+set of one bare name
(BAD_REQUEST); a move of a non-source kind (`MoveItem`, UNSUPPORTED).

**Migration.** Tests first, red before: CODESYS offline double with no `Implementation` aspect + a body → UNSUPPORTED,
transaction rolled back; TwinCAT dynamic double without `ImplementationText` / `DeclarationText` → UNSUPPORTED; Engine
`PushService` + `FakeIde`: a move into a `Device` / `TaskConfig` node → UNSUPPORTED, nothing applied, refs unchanged;
a `FakeIde` that ignores `Move` → refused naming the folder it stayed in. Then the code, then DIALECT rows for the
measured TwinCAT move. Live negatives are 8.2's. No LSP fixture: no text a user writes changes its answer.

## Step 7 — C2i refusal codes, `NOT_FOUND` as the post-condition code, U+FEFF splitter limit

**7.1 — target: the eight C2i hierarchy-vouch refusals (`TcObjectModel.cs:209, 216, 246, 295, 300, 308`,
`TcSolutionExplorer.cs:100, 111`) answer `ITEM_UNVERIFIED`, not `INTERNAL_ERROR`.** Measured: inside a walk every one is
caught by `BeckhoffDriver.WalkInner` and the folder goes to `unwalkedFolders` (no code reaches a client); the code
escapes only through an apply-time lookup (`ItemLookup`/`TreeNav` in a push), where it becomes the op's conflict. That
is exactly `ITEM_UNVERIFIED`'s meaning — "the push could not read where the item lives; the bridge/IDE is impaired; fix
what stops that folder being enumerated" — which the pre-apply gate already answers for the SAME folder when the walk
skipped it. One code for one situation, whichever phase meets it. `:216` (two children of one name in a guarded folder,
D34) is a project fact, but its remedy is the same (rename one, or repair the C2i POU, and the folder is read) — same
code, its message keeps naming D34. Rejected: `UNREADABLE` (its remedy is `force`, which overwrites an item; here no
item is read and `force` changes nothing); `UNSUPPORTED` (a permanent limit; these pass once the hierarchy vouches);
a new code (V.4: a second code for `ITEM_UNVERIFIED`'s situation); `PLC_DISCONNECTED` (the IDE answers).
Messages unchanged (they already name the folder and what the hierarchy did not vouch for).

**7.2 — target: the post-condition code is renamed `NOT_FOUND` → `IDE_LOST_ITEM` and documented as "the IDE no longer
holds what Volt just wrote or read, during the apply".** Audited at HEAD: all 18 sites are post-conditions (PushService
:897, 1019, 1133, 1171, 1427, 1532, 1546, 1659, 1899, 1924, 1939; `CodesysDriver.Content.cs:411`;
`BeckhoffDriver.Content.cs:170, 202, 286, 297`; `BeckhoffDriver.Tree.cs:448, 460`) — none answers "the request names
nothing" (that is `ITEM_MISSING`, from the gate, before anything is written). Measured: no client branches on
`NOT_FOUND` (0 matches in volt-cli's CLI, volt-control, volt-vscode); wire.html documents it wrongly ("the named item does
not exist … re-read refs"). Rejected: keep `NOT_FOUND` + document (the name still reads as `ITEM_MISSING`, the exact
confusion 7.2 names); fold into `INTERNAL_ERROR` (V.1 keeps that for Volt's own broken invariants; this is the IDE not
doing what it acknowledged, and the remedy differs — `volt pull` to see what landed, then retry, not "report a bug").

**7.3 — target: a U+FEFF after the start of the text stays refused by name, as niche: accepted loss.** Measured: 0
occurrences — leading or later — in the 30,167 files of the six corpora. Making the splitter read it as code everywhere
is not trivial: `StTrivia` blanks a U+FEFF at index 0 of whatever text it is handed, so every slice scan would need to
know whether its slice starts the text. The CODE follows one recording (fixture `ufeff_after_start`, a U+FEFF between
two tokens of a VAR line, CODESYS `record:language`): the build refuses it → `INVALID_ST` stays and the message quotes the
build; the build accepts it → `UNSUPPORTED` (a Volt limit, V.1) and the message says "Volt's splitter does not read
U+FEFF after the start of the text (niche: accepted loss, 0 occurrences in the corpora)". If the LSP's answer differs
from the recording, it is a known divergence with the same niche reason.

**Stays refused by name:** every C2i folder (unread, named, now `ITEM_UNVERIFIED`); every post-condition (now
`IDE_LOST_ITEM`); a mid-text U+FEFF.

**Migration.** Tests first: per C2i site an offline TwinCAT double (the `ReadExplorer` seam) asserting `ITEM_UNVERIFIED`
and the folder name — the existing `INTERNAL_ERROR` assertions change on the V.1 decision, not on code behaviour;
`ConflictCodes.ItemUnverified` doc widened to the apply-time lookup. 7.2: `BridgeErrorCodes.NotFound` →
`IdeLostItem = "IDE_LOST_ITEM"`, `FromBridge`, wire.html (both rows), `WireVocabularyGuardTests`, `DocDataTests`, the
`PushModels`/`PushService`/`IProjectTree` comments; the tests pinning these sites take the new code. 7.3: record the
fixture, then the message/code, `StReader` test pinned. No push-behaviour change in any of the three.
