# push-without-header-check — design

## Step 5 — Pull reads the kind from the IDE object, never from the text

(2026-09-30. Design only; no code. Tasks 5.1–5.3.)

### Target

After section 2, push takes an item's kind from its wire name's extension and writes the text as sent. Pull still
takes it from the TEXT, in two places:

- **DUT subtype.** `Materializer.FullWireName` mints `X.struct|enum|union|alias` from `CodeHelper.DutSubtype(declaration)`.
  A text that states no subtype throws, `Versioning.SafeVersion` lists the item `unreadable`, and then the push that
  would fix it is refused `UNREADABLE` (`PushConflicts:93`) and only `--force` deletes it (e2e 3.2, both vendors).
- **CODESYS POU kind.** `CodesysTypeMap.RefinePou` reads the header's leading keyword and defaults to
  `PlcPouFb`, so a `.prg` whose text opens an unclosed `(*` is published as `.fb` (bridge-refusal-review D2).

The target: every name a pull publishes comes from the IDE's own answer. When the IDE has no answer, Volt says
that. It does not guess a name. Acceptance (tasks 5.1–5.3): a DUT or POU pushed with an unclosed `(*` (or empty
text, or prose) pulls back under the name it was pushed under. The push that fixes it is accepted, a delete needs
no `--force`, and a live round trip keeps name and kind on both vendors.

### What each vendor exposes — measured

**CODESYS SP21, live, 2026-09-30** (scratch probe, `--noUI --runscript` on a copy of `CodesysTestProject.project`;
18 objects: DUTs created `create_dut(DutType.Structure)` and `create_dut(DutType.Enumeration)`, POUs created
`PouType.Program|FunctionBlock|Function`, each then given a text by `textual_declaration.replace`; read before
and after a build — identical):

1. **The object carries no kind apart from its text.** `DUTObject` (`IDUTObject`) and `POUObject` (`IPOUObject`):
   every readable property, two levels deep, 69 on a DUT and 113 on a POU, compared across all objects. The
   comparison left out the name, text and guid properties. The only property that differs is
   `UniqueIdGeneratorString`. The creation seed is NOT retained: a DUT created as `Enumeration` and one created as
   `Structure` are indistinguishable once they hold the same text, and so are a POU created as `Program` and one
   created as `FunctionBlock`. (This matches C2e's in-place subtype change and C2f's re-typing by text.)
2. **CODESYS's own answer is its language model's reading of the text.**
   `SystemInstances.LanguageModelMgr.GetPrecompileContext(appGuid).GetSignature(objectGuid)`, available without
   a build, current immediately after the write:

   | text written | `POUType` | `Flags` |
   |---|---|---|
   | `TYPE X : STRUCT … END_STRUCT END_TYPE` (either seed) | `Type` | `Structure` |
   | `TYPE X : ( Red, Green ); END_TYPE` (either seed) | `VarGlobal` | `Enum` |
   | `(* doc` + a well-formed STRUCT (never closed) | `None` | `None` (name `''`) |
   | `TYPE X : END_TYPE` | `Type` | **`Alias`** |
   | empty text / prose | `None` | `None` |
   | `PROGRAM X …` | `Program` | — |
   | `(* doc` + `PROGRAM` / `FUNCTION_BLOCK` / `FUNCTION` | `None` | `None` |
   | `PROGRAM X …` in an object created as a function block | `Program` (= C2f) | — |
   | empty POU text | `None` | `None` |

   `POUType` does not name a DUT subtype: an enum's `POUType` is `VarGlobal`. The subtype is in `Flags`.

**TwinCAT** (recorded, not re-measured): the POU kind is the tree code 602/603/604. It belongs to the object,
is always present, and does not follow the text (C2f). The DUT tree code 605/606/607/623 is NOT current. A
push-create is 606 whatever the body, and an in-place subtype change keeps the old code until a solution reload
(C2e). TwinCAT has no measured signature surface for project items. `ProduceAllLibrarySignatures` covers
libraries only (C2c). **So TwinCAT gives no current answer for a DUT's subtype.**

**The build oracle** (`volt-lsp-iec/test/conformance/recordings/{codesys,twincat}.build.json`, the written-as-sent
fixtures of 4.1) gives the same answer on both vendors for every DUT shape. A text that does not open with
`TYPE` (unclosed `(*`, empty, prose, `pwh_prose_then_struct`) declares nothing: `Unknown type: '<name>'` at the
reference. A text that does, builds as the shape it declares (`pwh_struct_text_is_enum`,
`pwh_enum_text_is_struct` build clean).

### Options, each measured against the recorded fixtures

Columns: what each source would publish. ✓ means the shape keeps the name it was pushed under, or matches both
compilers. ✗ means it breaks acceptance or disagrees with the build recording.

| shape (pushed as) | S1 Volt reads text (today) | S2 vendor tree code | S3 CODESYS signature | chosen |
|---|---|---|---|---|
| `pwh_unclosed_comment_struct` (`.struct`) | unreadable ✗ | CS: none ✗ · TC: 606 `.struct` ✓ | none → *unnamed* ✓ | unnamed, file kept ✓ |
| `pwh_unclosed_comment_enum` (`.enum`) | unreadable ✗ | CS: none ✗ · TC: 606 `.struct` ✗ | none → *unnamed* ✓ | unnamed, file kept ✓ |
| `pwh_empty_struct`, `pwh_prose_struct` | unreadable ✗ | CS ✗ · TC 606 | none ✓ | unnamed ✓ |
| `pwh_prose_then_struct` (`.struct`) | `.struct` (the compilers declare nothing) ✗ | TC 606 | none (from the build recording; not probed) | unnamed ✓ |
| `pwh_struct_text_is_enum` (`.struct`) | `.enum` ✓ (as e2e 3.2 asserts) | TC 606 `.struct` ✗ (compiler: enum) | `Enum` ✓ | `.enum` ✓ |
| `pwh_enum_text_is_struct` (`.enum`) | `.struct` ✓ | TC seed 606 `.struct`; an IDE-authored 605 stays `.enum` ✗ | `Structure` ✓ | `.struct` ✓ |
| a push-create of any `.enum/.union/.alias` | ✓ | TC 606 → `.struct` ✗, every time | ✓ | ✓ |
| a subtype change `X.struct → X.enum` (`DutSubtypeChanges`) | ✓ | TC old code → the next pull renames it back ✗ | ✓ | ✓ |
| `TYPE X : END_TYPE` (`.struct`) | unreadable ✗ | TC 606 | **`Alias` → `X.alias`** | CS `X.alias` (the IDE's answer; see *Owner decisions*); TC unnamed |
| `pwh_unclosed_comment_fb` (`.fb`) | CS: header default `.fb` (right by luck) | TC 604 ✓ | none → unnamed ✓ | CS unnamed, TC `.fb` ✓ |
| a `.prg` with unclosed `(*` (task 5.2) | CS `.fb` ✗ | TC 602 ✓ | none → unnamed ✓ | CS unnamed, TC `.prg` ✓ |
| `pwh_fb_text_says_program` (`.fb`) | CS `.prg`, TC `.fb` (C2f) | TC 604 `.fb` ✓ | `Program` → `.prg` ✓ | unchanged from today: CS `.prg`, TC `.fb` |
| `pwh_prg_text_says_function_block` | CS `.fb`, TC `.prg` | TC 602 | `FunctionBlock` (not probed; the mirror of the row above) | unchanged |

- **S1: Volt reads the text (today).** It fails the target by definition, and it fails acceptance on every
  shape that declares nothing. It also names `pwh_prose_then_struct` `.struct`, while both compilers say the
  text declares nothing.
- **S2: vendor tree/object code.** CODESYS has none (measured, point 1). The TwinCAT DUT code fails every
  push-create of a non-struct and every subtype change (C2e). The TwinCAT POU code is right for every row.
- **S3: CODESYS language-model signature.** It agrees with CODESYS's build on every probed shape. It is `None`
  exactly where the build says nothing is declared. It is CODESYS-only.
- **S4: the name the client pushed, remembered by the bridge.** Rejected. The IDE object has nowhere to store it
  (point 1), and Volt keeps no state and writes nothing into a vendor project beyond the item's own text.
- **S5: default when unknown** (today's `PlcPouFb` arm). Rejected: it guesses a name, which the no-fallback rule
  forbids.
- **"No answer" handling — N1 *unnamed*** vs **N2 `unreadable` + `--force` (today)**. N2 fails acceptance on
  every declares-nothing row. N1 is bridge-refusal-review D1 option (a).

### Choice

1. **The kind family comes from the object on both vendors** (POU / interface / DUT / GVL). This is unchanged:
   CODESYS uses the object interfaces (`IPOUObject`, `IInterfaceObject`, `IDUTObject`/`ITextListEnumerationObject`,
   `IGVLObject`), TwinCAT the tree code.
2. **POU kind.** On **CODESYS** it is the precompile signature's `POUType`: `Program` → 602, `FunctionBlock` →
   604, `Function` → 603. On **TwinCAT** it is the tree code, as today, so 5.2's TwinCAT half needs no code, only
   5.3's live check. C2f's asymmetry stays as recorded.
3. **DUT subtype.** On **CODESYS** it comes from the signature's `Flags`: exactly one of `Structure` / `Enum` /
   `Union` / `Alias` names the subtype. On **TwinCAT** the tree code is not current, so the subtype is read by
   the driver below the seam (`BeckhoffDriver`), with the rule both compilers were recorded to follow: the text
   must OPEN with `TYPE` (trivia allowed, the same rule the LSP adopted in 4.2(a)); then the first code token
   after the colon decides, as `CodeHelper.DutSubtype` does today. Anything else gets no answer. This is the one
   remaining text read on pull. It is a stand-in for the vendor answer, owned by the one driver that lacks one.
   It is checked against TwinCAT's own build recordings, and it is marked as an owner decision (below).
4. **No answer → *unnamed*, not unreadable, not guessed.** An object whose kind the IDE does not state (CODESYS
   signature `None`; the TwinCAT DUT rule above finding no subtype) is still read and versioned. `refs`/`fetch`
   publish it in a new map `unnamed: { <bare>: { family, version } }`, where `family` is `pou` or `dut`.
   `unreadable` keeps its meaning: the IDE could not be read at all.
   - **Push:** a `set` or `delete` on any name of that family (`X.fb|prg|fun`, `X.struct|enum|union|alias`)
     whose `ifVersion` matches the unnamed item's version reaches it. This is the path `DutSubtypeChanges`
     already uses for a DUT's bare identity, and a POU gets the same one. The re-type guard has no live kind to
     compare, so the name's kind is written (on CODESYS the text then decides, C2f). No `--force` is needed.
   - **Pull (CLI):** an unnamed item keeps the workspace file of the same bare name and family. That file name is
     what the client pushed, and git holds it. The text is fetched and written into that file.

### What stays refused, by name

- **An unnamed item with no workspace file to name it** (a fresh `init`, or an item the IDE created): the pull
  writes no file for it and reports `'<X>': the IDE holds a <family> whose text declares no kind, and no file in
  the workspace names it`. It stays listed in `unnamed`, so it is visible, never deleted, and never guessed.
- **A push naming another family** than the unnamed or live item (`X.gvl` over a DUT, `X.struct` over a POU): the
  re-type guard, unchanged ("a push cannot re-type an object by its NAME").
- **A signature that breaks the vendor contract.** If the precompile context is unavailable, or if `Flags` on an
  `IDUTObject` has none or several of the four subtypes while `POUType` is not `None`, the item is `INTERNAL_ERROR`,
  named. It never falls back to the text.
- **Items that genuinely cannot be read** (COM error, driver throw): `unreadable` + `--force`, unchanged.
- Not refused: `TYPE X : END_TYPE` on CODESYS is published `X.alias` (CODESYS's own answer). The CLI reports the
  rename (`Commands.HeldUnderAnotherName`), as it does for C2f.

### Owner decisions required before code (task 5.1: "decide with the owner before falling back to anything")

1. **TwinCAT DUT subtype = the driver-owned "opens with TYPE" read** (choice 3). The alternatives are the tree
   code (fails every create and subtype change, measured C2e), or making every TwinCAT DUT unnamed (a fresh pull
   could name no DUT). Recommended: the driver read.
2. **The *unnamed* state** (choice 4) as the answer to "no vendor answer", on both vendors.
3. **Amend 5.1's acceptance for `TYPE X : END_TYPE` on CODESYS**: CODESYS declares it an alias, so it pulls back
   as `X.alias`, not under `.struct`. The proposal already accepts "a renamed item that `refs` then reports".
   TwinCAT's answer for this shape has not been recorded.

**Owner decision (2026-10-02): a DUT with no vendor subtype answer is published as a generic `.dut`, not
*unnamed*.** It IS a DUT; only the subtype is unknown. This replaces choice 4 and owner decision 2 for DUTs (POUs
with no answer are not covered by it and stay open). Consequences for the implementation (not done here): push
accepts `X.dut` for any DUT (create, update, delete); once the text parses again the next pull names it
`.enum`/`.struct`/`.union`/`.alias`, a rename in git (`Commands.HeldUnderAnotherName`, as for C2f); `.dut` joins the
writable-source extension set everywhere `bun run check` gates parity (C#, the LSP, volt-control, the four places in
the VS Code manifest). How often `.dut` appears is what the evidence below decides.

### Vendor evidence (2026-10-02)

Measured live on both vendors, every item kind created in a fixture copy and every reachable source dumped side by
side: `scripts/probe-kind-source.py` + `kind-source.log` (CODESYS SP21, Pro2193 copy), `scripts/probe-tc-kind-source.ps1`
+ `tc-kind-source.log` (TcXaeShell 4024.74, Project14 copy). DIALECT C2g (CODESYS), C2h (TwinCAT), C2i (TwinCAT crash);
C2f corrected. This supersedes the TwinCAT paragraph above, which was recorded, not re-measured.

**CODESYS** — ✓ right, ✗ wrong, — carries nothing.

| item (text) | object / meta / icon / `GetLanguageModel` | navigator caption | precompile signature (no build) | after build |
|---|---|---|---|---|
| struct / enum / union / alias, created by own `DutType` or Volt's `Structure` seed | — (one class, one icon, text only) | `(STRUCT)` `(ENUM)`; union, alias none | ✓ `Type`+`Structure` / `VarGlobal`+`Enum` / `Type`+`Structure, Union` / `Type`+`Alias` | ✓ same |
| any of those changed in place | — | follows | ✓ at once | ✓ |
| text-list enum (`IQSlices`) | own class `TextListEnumerationObject` (family) | `(ENUM)` | ✓ `VarGlobal`+`Enum` | ✓ |
| unclosed `(*`, empty, prose (DUT or POU) | — | none | `None`/`None`, `HasErrors` → no answer (`.dut`) | same |
| `TYPE X : END_TYPE` | — | none | `Type`+`Alias`, `HasErrors=True` (CODESYS's own reading) | same |
| PRG / FB / FUN / interface / GVL, and a PRG holding FB text | class = family | `(PRG)` `(FB)` `(FUN)`; itf, GVL none | ✓ `POUType` follows the text (C2f) | ✓ |
| library DUTs | | | `LibSignature.Flags` carries the subtype for every library `Type` (1278 struct, 51 union, 94 alias, 550 enum; no `Type` without a flag) | |

**Conclusion, CODESYS: yes — the precompile signature is a text-free source that is always the IDE's answer**, current
without a build. `.dut` appears only for a text that declares nothing. `HasErrors` must not be read as "no answer":
a duplicate enum member is `Enum` with `HasErrors=True`.

**TwinCAT**

| source | in-session create (own code) | Volt 606 seed + other body | in-place subtype change | text declares nothing | after reload | reachable |
|---|---|---|---|---|---|---|
| `ItemType` / `ItemSubTypeName` / `ProduceXml` | ✓ | ✗ (606) | ✗ lags | ✗ 606 in session | ✓ re-derived; ✗ nothing-declared → **623 alias** | COM |
| `ItemSubType` | 0 for every item | | | | | COM |
| `DocumentXml`, `.TcDUT`/`.TcPOU`, `.plcproj` | — | — | — | — | — | COM / disk |
| icon (`VSHPROPID_IconHandle`) | one icon for all DUTs | | | | | VS hierarchy |
| `ITcPlcProjectInternal.LanguageModel` | empty | | | | empty | COM (reflection) |
| Solution Explorer caption (`VSHPROPID_Caption`) | ✓ `(STRUCT)` `(ENUM)` `(UNION)` | ✓ | ✓ at once | no suffix | ✓ | VS hierarchy, out of process |
| ... for an alias | no suffix (= nothing-declared) | no suffix | no suffix | | no suffix | |
| TMC `<DataType>` | build only, only types a symbol uses; union only inferable from offsets | | | absent | | disk |
| `_CompileInfo/*.compileinfo` | build only, binary 3S signatures, compiled items only | | | | | disk |
| POU kind: tree code 602/603/604 | ✓ | — | stays (C2f) | stays; **after reload the item CRASHES XAE on access (C2i)** | ✓ re-derived from text | COM |
| POU kind: caption | `(PRG)` `(FB)` `(FUN)` | | follows the text | no suffix | ✓ | VS hierarchy |

**Conclusion, TwinCAT: no text-free source is always right.** The 3S language model exists inside TcXaeShell (same
plugin GUIDs as CODESYS), but no automation call exposes a project item's signature; reaching it needs code in that
32-bit process (a VS package, N6), which Volt does not have and which would be a new install into the vendor's IDE.
The best non-text option is the **caption** read through `IVsHierarchy` — the IDE's own parse, current without reload
or build — combined with the tree code for the one case it cannot name:

- caption `(STRUCT)`/`(ENUM)`/`(UNION)` → that subtype ✓ always (measured in every phase);
- no suffix and `ItemType` 623 → `.alias`: right for every real alias after a load or an IDE-authored alias; ✗ for a
  text that declares nothing after a reload (C2h: it reloads as 623), which would publish as `.alias`;
- no suffix and 605/606/607 → only in the session that wrote the text: either a Volt-created alias (606 seed) or a
  text that declares nothing — the caption cannot tell them apart. Here `.dut` (the owner decision) is honest but
  hits **every alias Volt creates until the solution is reloaded**.

Failure cases of the caption itself: it is a display string (`"Name (ENUM)"`), so reading it is parsing UI text —
localization and any XAE option that hides the suffix are UNMEASURED; it needs the VS shell interop and a walk of the
hierarchy to map file → node. A driver-owned text read ("opens with TYPE", choice 3) would still be needed only to
separate *alias* from *declares nothing* in the session that wrote it, and to avoid publishing a broken text as
`.alias` after a reload. And independently of the subtype question: **a TwinCAT POU whose text declares nothing makes
the next solution load crash on access (C2i)** — so on TwinCAT the push of such a POU text is not merely "unnamed on
pull", it breaks the project for every tree walk, and acceptance 5.1/5.3's "a POU pushed with an unclosed `(*` pulls
back" cannot hold there across a reload.

### Migration

Order: evidence first, then the red tests, then the swap.

1. **Evidence.** Commit the probe to `packages/volt-cli/scripts/probe-kind-source.py` plus its log, adding
   `pwh_prose_then_struct`, `pwh_prg_text_says_function_block`, an `ITextListEnumerationObject` (Pro2193 `IQSlices`)
   and an interface. Add a DIALECT row (C2g): the CODESYS kind lives only in the language model. Record a new
   written-as-sent fixture `pwh_dut_type_end_type` on both vendors (`record:language`, RECORD_ONLY), then
   `rate:fixtures`.
2. **Red tests** (offline, `FakeIde` gains a per-item "IDE kind answer", `null` = none): the engine publishes
   `unnamed` for no-answer DUTs and POUs; a set/delete by version reaches it; CLI pull keeps the file, or refuses
   by name when there is none. e2e 3.2's `held: "unreadable"` rows become `unnamed`, and the forced cleanup
   becomes a plain delete. Add 5.3's round trip (push, pull, push fixed, pull) on both vendors.
3. **CODESYS driver.** `CodesysTypeMap.RefinePou`, `LeadingKeyword` and `NeedsDeclaration` are deleted, and so is
   the declaration read in `CodesysDriver.Tree` `KindCodeOf`. The POU code and the DUT subtype come from one
   signature lookup (`CodesysObjectModel`, next to `ExtractLibrarySignatures`'s `LanguageModelMgr` use). A new
   internal code `ItemKind.PlcPou` covers a POU the IDE does not type. Whether the lookup is cheaper than the text
   read it replaces has not been measured; the push pre-flight timing checks it.
4. **Engine contract.** The driver reports the DUT subtype (`IIdeDriver`: kind plus an optional subtype;
   `null` = none). `Materializer.FullWireName` uses it and no longer calls `CodeHelper.DutSubtype`.
   `Versioning`/`RefsService`/`FetchService` publish `unnamed`. `PushConflicts:93`, `PushService:209`
   (`UnreadableDut`) and `DutSubtypeChanges` match the bare identity for an unnamed item. `ItemKind.cs:293` and
   the `CodeHelper.DutSubtype` docs are rewritten (bridge-refusal-review D18).
5. **TwinCAT driver.** `BeckhoffDriver` owns the "opens with TYPE" subtype read. It moves out of `CodeHelper`,
   and `CodeHelper.DutSubtype` is deleted.
6. **Library signatures.** `LibSignatureRenderer.Dut` takes the subtype from the signature's `Flags`, which are
   already captured (`LibSignature.Flags`). This removes the last engine caller of the text read.
7. **Wire and consumers.** `RefsFetch.unnamed` goes into `Volt.Contracts`, `docs/wire.html` and the generated
   doc data. The CLI (`IdeTree`) and the TS e2e client are updated; volt-control/desktop/vscode are checked
   (they read CLI output, not the wire).

## Step 5.H — TwinCAT: a walk that never touches a POU whose text declares nothing

(2026-10-02. Design only; no code. Task 5.H.1. DIALECT C2i.)

### Target

After a solution load, the first touch of the tree item of a TwinCAT POU whose text declares no POU kind
(`Child(i)` on its index, `LookupChild(name)`) kills TcXaeShell: RPC `0x800706BE` to the caller, access violation
`0xc0000005` in `TwinCAT System Manager.dll` 3.1.0.4384. Volt's walk (`BeckhoffDriver.WalkInner`), every
engine lookup (`ItemLookup.Walk`, `TreeNav`, `MemberSites`) and the object-model helpers
(`TcObjectModel.FindLibraryManager`, `TcObjectModel.Task`) enumerate children with `Child(i)`. So one such POU makes
every `refs`, `fetch`, `pull`, `push` and `build` crash the engineer's IDE. Section 2 makes this reachable from Volt
itself: a push writes a POU's text as sent, so `pwh_unclosed_comment_fb` pushed to TwinCAT, saved and reloaded is
exactly this state.

Acceptance: on such a project the walk completes, names every other item, and names the broken POU in
`unreadable`. XAE stays alive. The POU can be repaired by a push. Nothing in Volt touches its tree item.

### Measured (2026-10-02, TcXaeShell 4024.74 / System Manager 3.1.0.4384)

Scratch probe (`probe-5h.ps1`, in the session scratchpad; it reuses `probe-tc-kind-source.ps1`'s ROT and
`IVsHierarchy` code). It ran against a copy of the kind-probe's saved Project14 (which holds `VltK_BP`, C2i's POU),
opened by a TcXaeShell this probe started under `volt-ide-twincat-push-without-header-check`. A census folder
`VltCensus` was created in-session with the recorded written-as-sent texts, saved, and the solution reloaded
(`Solution.Close` + `Open`). Each item was then touched ONCE by `LookupChild`, with the read written to a trace file
first, and XAE's survival checked (Application event 1000 on every crash):

| item (text) | tree code | Solution Explorer caption | first touch after reload |
|---|---|---|---|
| `VltK_BP` (C2i: `(* doc` + PROGRAM) | 602 | `VltK_BP` (no suffix) | **crash** (C2i, 4×; not re-touched here) |
| `VltX_EP`: PROGRAM, empty text | 602 | `VltX_EP` | **crash** (`0xc0000005` at `0x00bc6df8`) |
| `VltX_PP`: PROGRAM, prose | 602 | `VltX_PP` | **crash** (same) |
| `VltX_UCF`: `(* doc` + FUNCTION | 603 | `VltX_UCF` | **crash** |
| `VltX_UCFB`: `pwh_unclosed_comment_fb`'s text | 604 | `VltX_UCFB` | **crash** |
| `VltX_FP`: `pwh_fb_text_says_program` (604 holding PROGRAM) | 604, reloads 602 | `VltX_FP (PRG)` | ok |
| `VltX_MB`: FB + METHOD `M` whose text opens `(* doc` | 604 / 609 | `VltX_MB (FB)` / `M` | ok; `Child(1)` = `M` ok |
| `VltX_UCI`: interface, `(* doc` + INTERFACE | 618 | `VltX_UCI` | ok |
| `VltX_UCG` / `VltX_PG` / `VltX_EG` = `pwh_unclosed_comment_gvl` / `pwh_prose_gvl` / `pwh_empty_gvl` | 615 | no suffix (a GVL never has one) | ok |
| DUTs that declare nothing (`VltK_BC/BE/BT`, C2h) | 623 | no suffix | ok |

So the crash is exactly this case: **a POU (`.TcPOU`: PROGRAM / FUNCTION_BLOCK / FUNCTION) whose text the IDE
does not read as a POU**. That held for 5 of 5 such items, and for none of the 21 other items (GVL, interface, DUT,
method, a POU whose text declares the other POU kind). Further facts, each measured on the same copy:

- **The VS hierarchy reaches the item without crashing.** `IVsSolution` → `IVsHierarchy` over the DTE's
  `IServiceProvider`, out of process, listed every node, the crashing POUs included, on every run (8 reads, before
  and after the reload and after the crashes). Cost: 73–142 ms per full read of the 143-node solution (688–763 ms on
  the first read in a fresh process).
- **The caption shows whether the IDE parsed a POU, and it updates at once.** A `.TcPOU` node's caption is
  `<name> (PRG|FB|FUN)` while the IDE reads a POU from its text, and the bare `<name>` otherwise. Writing `(* doc`
  before `VltK_P`'s declaration in the live session dropped `(PRG)` immediately; writing the original back
  restored it. An empty text on `VltK_FB` dropped `(FB)`. A POU recreated with a fixed text read `(PRG)` at once.
  The design below uses only whether a suffix is PRESENT, never its spelling.
- **The hierarchy lists a folder's children the way the tree does.** For the PLC project root (13 children:
  External Types, References, 6 folders, 2 POUs, the task, the `.tmc`), for `VltKind` (18) and for `VltCensus`
  (10), the hierarchy gave the same names, in the same order, as `Child(1..n)`. A file's canonical name is
  `<tree name>.<ext>`. A POU's members are child nodes (`X.TcPOU;X.M`).
- **Siblings are safe.** `Child(i)` read normally for every index of `VltKind` except the crashing one, and for every
  index of `VltCensus` except its four. So did `LookupChild` of each sibling by name (17 names in C2i's log, 6 here).
- **The parent's own XML lists no children.** `VltKind.ProduceXml(false)` and `ProduceXml(true)` are
  byte-identical: 379 characters, `ChildCount 18`, no child name. This is the same as on a property
  (`InterfacePropertyAccessors`).
- **The item can be repaired without touching it.** `VltKind.DeleteChild("VltK_BP")` returned, ChildCount went
  18 → 17, and XAE stayed alive. `CreateChild("VltK_BP", 602, "", "ST")` plus a fixed declaration then gave a
  normal item: `ItemType 602`, caption `VltK_BP (PRG)`, at index 4 (the tree keeps its order). After that, the full
  index walk of `VltKind` (1..18) read every item.
- **In the session that wrote the text, the item is safe to touch.** The census items were created, written and
  read in-session without a crash, as C2i recorded for `VltK_BP`. The crash risk starts at the next load.
- **This shape does not occur in the real corpora.** 0 of 16,990 POU files in the six corpora (`test-corpus/*`:
  awa-palletizer 3642, bakon-nano 3763, CodesysTestProject 529, lenze-mid 4241, pro2193 4592, twincat-project14
  223) declare no POU kind after leading comments and pragmas. It still does not qualify as "niche: accepted loss":
  Volt's own push can now produce it (section 2), and the cost is the engineer's IDE crashing on every operation
  until the file is fixed outside Volt.

### Options, each measured

| option | avoids the crash? | names the item? | verdict |
|---|---|---|---|
| A. Guard the read (`try` around `Child(i)`), as the walk does for other faults | ✗ the crash happens inside TcXaeShell; the catch receives `0x800706BE` after XAE has died (5 of 5) | — | rejected: Volt's side has nothing to guard |
| B. Names and kinds from the parent's `ProduceXml(true)` | — | ✗ no child appears in it | rejected |
| C. Names from the `.plcproj` `Compile` items; the crash predicted from the `.TcPOU` declaration on disk | ✓ if the prediction is right | ✓ | rejected: Volt would parse a POU's text to decide what it is, which is the read 5.F deletes. It would also be guessing at the vendor's own parse, which the caption already states |
| D. **The Solution Explorer hierarchy: a `.TcPOU` node whose caption is its bare name is never touched** | ✓ flags 5 of 5, and 0 of the 21 others | ✓ by its hierarchy name | **chosen** |
| E. D's flag, then skip that INDEX in the ordinary `Child(i)` walk | ✓ (measured: skipping index 4 of 18, and 2/6/7/8 of 10) | ✓ | rejected as the mechanism: safety would depend on the hierarchy's ORDER matching `Child(i)`'s. That held on three folders, but the vendor does not promise it. D addresses siblings by NAME instead, which depends only on the names matching |
| F. Prevent it at push: after writing a POU text, refuse and restore when the caption loses its suffix | ✓ for Volt's own pushes | — | rejected: it is the header check section 2 removed, answered by the IDE instead of Volt. It does nothing for a project broken in XAE or before Volt. The in-session state is harmless, and the walk guard covers the next load |
| G. Refuse the whole walk when any POU is flagged | ✓ | ✓ | rejected: one broken POU would block every pull and push of the project |
| H. Read the item in-process (a VS package in TcXaeShell) | ? | ? | rejected: a new install into the vendor's IDE (N6) |

### Choice

**D: the TwinCAT object model never calls `Child(i)` or `LookupChild` on a POU that the IDE does not parse as a
POU, and it names that POU instead.**

1. **One snapshot per operation.** `TcObjectModel` reads the Solution Explorer hierarchy of the served PLC project
   once per operation, at the same reset point as `BeckhoffDriver._declarations` (`WalkItems`, and the start of
   each op that resolves an item without a walk). It reads it again after any structural write in that op (create,
   delete, rename, move, text write), because a write can flag or unflag a POU. The snapshot holds, for every tree
   path, its child names in hierarchy order, and the set of **untouchable** children: `.TcPOU` nodes whose caption
   equals the node's own name.
2. **`TcObjectModel.ChildAt` is the single point of control.** It is the only member that calls `.Child[i]` on a
   PLC node. The walk, the engine's lookups (through `BeckhoffDriver.ChildAt`), `FindLibraryManager` and the task
   helpers all go through it.
   - Fast path, which every real project takes: the snapshot has no untouchable item, and `ChildAt` makes exactly
     today's call, with no extra COM read.
   - Guarded path, for a parent that holds an untouchable child (identified by its tree `PathName`, which is read
     only in this case): its children are addressed BY NAME. `ChildAt(parent, i)` becomes
     `LookupChild(names[i-1])`, after checking that `ChildCount(parent) == names.Count`. For the untouchable name,
     `ChildAt` throws `UnreadableItemException(name, reason)` without making any COM call. A count mismatch throws
     an ordinary fault, and the folder is marked unwalked (see below).
3. **Walk.** `WalkInner` catches `UnreadableItemException` and records `UnreadableObject(name, folder, reason)`.
   The folder still counts as complete, so deletions elsewhere in it are still derived. `refs`/`fetch` list the item
   in `unreadable` with this reason: *"TwinCAT does not read 'X' as a POU; touching its tree item crashes
   TcXaeShell after a load (DIALECT C2i), so Volt does not read it. Push the fixed text with --force."* The CLI
   keeps the workspace file, as it does for any unreadable item.
4. **Lookup.** `ItemLookup.Walk` (engine) catches `UnreadableItemException`. If the child IS the name being looked
   up, the op is refused `UNREADABLE`, by name. For any other name the child is skipped (a POU is never a folder to
   recurse into), so pushes to its siblings work. Today any child fault refuses the whole lookup; that stays true
   for every other fault.
5. **Push.** The existing unreadable rules apply unchanged: a set or delete on that name without `--force` is
   refused `UNREADABLE`, by name. With `--force`, a delete is the parent's `DeleteChild(name)`, and a set is
   `DeleteChild(name)` followed by the ordinary create path with the pushed kind and text (both measured above). The
   driver refuses any write that would need the item's own handle.
6. **The hierarchy is required.** If it cannot be read (the service is unavailable, or the PLC project node is
   not found), the operation fails `INTERNAL_ERROR` with this message: "the Solution Explorer hierarchy is
   unreadable; Volt does not walk the TwinCAT tree without it (DIALECT C2i)". There is no fallback to an unguarded
   walk.

Counted fallbacks (owner: every fallback is named, tested and counted): **one**, the untouchable POU listed in
`unreadable`. Among the recorded fixtures it applies only to `pwh_unclosed_comment_fb` (TwinCAT, after a reload).
In the six corpora it applies to 0 items.

**CODESYS: no change.** Its in-proc object model reads such a POU without harm; what it publishes for one is 5.D's
subject. The two vendors' wires differ here because of a vendor fact (C2i), which DIALECT records.

### What stays refused, by name

- **An untouchable POU** (above). It is listed in `unreadable`, and any op on its name without `--force` is
  refused `UNREADABLE`. Volt never reads its text, version or kind.
- **A folder whose child count disagrees with the hierarchy's** while it holds an untouchable child. That folder
  is unwalked (no deletions are derived beneath it), and an op that must resolve an item in it is refused
  `INTERNAL_ERROR`, naming the folder. This has not been seen to occur; it guards the name addressing.
- **An unreadable hierarchy:** the whole operation fails `INTERNAL_ERROR`, named (choice 6).
- Not measured, and recorded as such: a TcXaeShell option or UI language that shows no suffix on ANY POU would
  flag every POU. Every op would then refuse loudly, but nothing would crash. Also not measured: whether opening
  such a POU's editor in XAE crashes too.

### Migration

1. **Red tests first** (`Volt.Ide.Twincat.Tests`, dynamic doubles as in `TcWalkUnreadableObjectTests`). Add a
   `Node` double whose `Child[i]`/`LookupChild` on a poisoned child **throws `COMException(0x800706BE)` and kills
   the double**: every later call on any node throws the same error, as a dead XAE does. Add a hierarchy double
   (names, captions). The tests assert that:
   - `WalkItems` completes, never touches the poisoned child, names it in `unreadable` with the reason, and emits
     every sibling;
   - `ItemLookup.Find` of a sibling succeeds, and of the poisoned name refuses `UNREADABLE`;
   - a forced delete calls only `DeleteChild(name)`, and a forced set deletes then creates;
   - the fast path (nothing flagged) makes no `PathName` or `LookupChild` call;
   - a count mismatch marks the folder unwalked;
   - an unreadable hierarchy fails the walk.

   In `Volt.Engine.Tests`, cover `ItemLookup` with a `FakeIde` child that throws `UnreadableItemException`.
2. **Hierarchy reader.** New file `Ide/TcSolutionExplorer.cs`. It declares the COM interfaces it needs
   (`IServiceProvider` (OLE), `IVsSolution`, `IVsHierarchy`, `IEnumHierarchies`) locally with `[ComImport]`, so no
   TcXaeShell assembly is loaded into the net10 worker. It ports the walk from `probe-tc-kind-source.ps1` and
   produces the snapshot. It is the only place the caption is read.
3. **`TcObjectModel.ChildAt`** gets the guard (choice 2). `UnreadableItemException` lives in `Volt.Engine/Ide` next
   to `IProjectTree`, and `IProjectTree.ChildAt`'s documentation says a driver may name a child it must not open.
4. **`BeckhoffDriver.WalkInner`**, **`ItemLookup.Walk`** and the TwinCAT `Delete`/write paths change as in choices
   3–5. `PushService`'s forced set on an unreadable TwinCAT item becomes delete + create.
5. **Docs.** DIALECT C2i gets the census table above and the rule "touched only through the hierarchy".
   `ARCHITECTURE.md`'s walk section names the snapshot.
6. **Live check** (task 5.H.1, `ide.ps1 -Instance push5`). Push `pwh_unclosed_comment_fb` as a `.fb` to a
   Project14 copy, save, then `ide.ps1 down` / `up` on the SAVED copy. Run `volt status` / `refs` and confirm: XAE
   is alive, the POU is named in `unreadable`, and every other item is present. Then `volt push --force` the fixed
   text, and confirm `volt pull` names it `.fb` and a further reload walks clean. Repeat for the empty and prose
   texts.

## Step 5.B — Contract: the driver states a DUT's subtype; no answer publishes `name.dut`

> **Superseded by step 5.P** (owner, 2026-10-02): every DUT is `name.dut`; the subtype answer, its contract field and
> the bare-identity push path below are deleted. Kept as the record of what shipped in ec0152fe0f.

(2026-10-02. Design only; no code. Tasks 5.B.1–5.B.3. Builds on the owner decisions of section 5 and 5.A.2.)

### Target

Today `Materializer.FullWireName` mints a DUT's extension from `CodeHelper.DutSubtype(declaration)`: the ENGINE reads
the text, and a text that states no subtype throws, so `Versioning.SafeVersion` lists the item `unreadable` and every
op on it needs `--force` (e2e 3.2). After 5.B:

1. **The driver states the subtype, the engine only spells it.** `ReadContent` hands up the vendor's answer, one of
   `struct | enum | union | alias`, or **null = the vendor has no answer**. `FullWireName` maps it to the extension;
   null gives **`name.dut`**. The engine never reads a DUT's text for its name again.
2. **`.dut` is a wire name and a writable source extension everywhere** (C#, the CLI registry, the LSP, volt-control,
   the four VS Code manifest places), so `bun run check` parity holds and a push accepts `X.dut` for any DUT
   (create, update, delete), writing the text as sent.
3. **`.dut` ↔ subtype is a rename, never a refusal.** A pull that finds `E_Mode.dut` published as `E_Mode.enum` (the
   text was fixed in the IDE) is an ordinary git rename. A push of `E_Mode.dut` over the IDE item that now answers
   `.enum` reaches it by its bare DUT identity, gated by the version it quotes. No refusal, and no `--force`.

The bare name, the folder and the version (`Hasher.ComputeItemVersion(folder, text)`) are identical either way. Only
the extension follows the vendor's answer.

### Measured against the recorded fixtures and the corpora

Where the answer comes from is decided by 5.C (TwinCAT) and 5.D (CODESYS). 5.B fixes how it travels and what null
publishes, so the measurements below are about that.

- **How often `.dut` is published.** A scratch scan (`dutscan.py`, in the session scratchpad, not the repo) applied
  the subtype rule (`TYPE name [EXTENDS …] :` then STRUCT / UNION / `(` / a type, trivia and pragmas skipped) to every
  DUT file in the six corpora: **8175 DUTs** (awa-palletizer 1738, bakon-nano 1784, CodesysTestProject 168,
  lenze-mid 2344, pro2193 2127, twincat-project14 14; 28% of the 29,170 source files). **All 8175 state a subtype,
  and every one agrees with its file's extension. That is 0 `.dut`**, matching the section's acceptance for compiled
  DUTs. Of the recorded conformance DUTs (33 struct, 9 enum, 6 alias, 3 union fixtures, plus `data-type.ts`), only
  the written-as-sent shapes that declare nothing have no answer:

  | fixture (pushed as) | CODESYS signature (5.A, design above) | interim stand-in (below) | published after 5.B |
  |---|---|---|---|
  | `pwh_unclosed_comment_struct` (`.struct`) | `None` | null | `.dut` (was `unreadable`) |
  | `pwh_unclosed_comment_enum` (`.enum`) | `None` | null | `.dut` (was `unreadable`) |
  | `pwh_empty_struct`, `pwh_prose_struct` | `None` | null | `.dut` (was `unreadable`) |
  | `pwh_prose_then_struct` (`.struct`) | `None` (build: declares nothing; not probed) | `struct` ✗ | `.struct` until 5.C/5.D, then `.dut` |
  | `TYPE X : END_TYPE` (5.A.1 shape, no fixture yet) | `Alias` | null | `.dut` until 5.D (CODESYS → `.alias`); TwinCAT per 5.C.3 |
  | `pwh_struct_text_is_enum`, `pwh_enum_text_is_struct`, `pwh_struct_then_prose`, `pwh_struct_missing_semicolon`, `pwh_struct_member_implementation` | `Enum` / `Structure` / `Structure` / `Structure` / `Structure` | same | `.enum` / `.struct` ×4 (unchanged) |

  Four fixture shapes move from `unreadable` to `.dut`. Two still disagree with the vendor during the interim, and
  they are the reason 5.C and 5.D exist. Two more interim shapes, found in the 5.B review, have no fixture and no
  vendor measurement; both are 0 of the 8175 corpus DUTs (counted 2026-10-02: no DUT file lacks a `TYPE` line, none
  has a digit after its type colon), so they are niche, accepted until 5.C/5.D replace the stand-in:

  | shape (no fixture) | CODESYS signature | interim stand-in | FakeIde (`DutAnswerFor`) |
  |---|---|---|---|
  | `X : STRUCT a : INT; END_STRUCT END_TYPE` (no `TYPE` keyword) | unmeasured, probably `None` | `struct` (takes the first colon) | null (requires `^TYPE name`) |
  | `TYPE X : 5; END_TYPE` (digit where a type stands) | unmeasured, probably `None` | `alias` (a digit-led token passes) | null (requires an identifier-led token) |
- **What each way of carrying the answer costs.** `Materializer.Materialize` is the only path that names an item
  (`Versioning.SafeVersion` for refs/fetch/receipts, and `PushService.NamesThisItem`). It always calls
  `ReadContent`, which already holds the declaration in both drivers (`BeckhoffDriver.ReadContent`,
  `CodesysDriver.ReadContent`). No path needs a DUT's wire name without reading its content. `KindCode` is called at
  11 engine sites, every child of every lookup walk among them. A DUT has no body and no members, so its
  `ReadContent` makes one TwinCAT declaration read (`_om.ReadDeclaration`).

### Options

| option | where the answer travels | cost per DUT per refs | verdict |
|---|---|---|---|
| **B1. `ItemContent.DutSubtype`** (`DutSubtype?`, set by `ReadContent`) | with the content the materializer already reads | +0 calls. TwinCAT classifies the declaration it just read. CODESYS makes one signature lookup inside the same call | **chosen** |
| B2. A new `ICodeStore`/`IProjectTree` member `DutSubtype(ItemRef)` | a second driver call | +1 call. On TwinCAT a second `ReadDeclaration` (1 → 2 COM reads per DUT, ×8175 on the corpora) unless a per-op cache is added. That cache would be a second copy of `_declarations` with its own invalidation | rejected: it doubles the TwinCAT read for no new fact |
| B3. Encode the subtype in `KindCode` (605/606/607/623, plus a new "unknown" code) | the tree code | an answer on every walk step and lookup (11 sites), not only on materialize. CODESYS would make a signature lookup per DUT per lookup | rejected: `KindCode` is the VENDOR's tree code. TwinCAT's code lags (C2e), and 623 also means "declares nothing after a reload" (C2h), so a driver would have to return a code the vendor does not hold. It also leaks into `CreateChild`'s seed (TwinCAT creates 606 for every DUT) |
| B4. The driver returns the extension or the full wire name | `ReadContent` | +0 | rejected: `Materializer.FullWireName` is the one place a wire name is minted (`VersionedItem.Identity` keys on it). A string extension from a driver could be anything, so the engine would have to re-validate it |

B1's one objection is that `ItemContent` is the model shared by both directions (the reader builds one from text on
push). There is precedent: `Unsupported` is the same kind of fact. A driver sets it on read; it is null from a file,
and nothing on the write path reads it. `DutSubtype` follows that rule: `StReader` never sets it, and `WriteContent`
never reads it.

### Choice

1. **Type.** `Volt.Engine.Item.DutSubtype` is an enum: `Struct | Enum | Union | Alias`. A closed set, so a driver
   cannot invent an extension. A CODESYS text-list enum (`ITextListEnumerationObject`, signature `VarGlobal`+`Enum`,
   C2g) answers `Enum`.
2. **Contract.** `ItemContent` gains `DutSubtype? DutSubtype` (last, optional, like `Unsupported`). Its documentation
   on `ICodeStore.ReadContent` says: for a DUT it is the VENDOR's answer, and null means the vendor has none. For
   every other kind it is null.
3. **Minting.** `FullWireName(bare, content)` uses `ItemKind.DutExtension(DutSubtype?)`, which reads from the one
   extension table: `Struct → struct`, …, `null → dut`. It no longer calls `CodeHelper.DutSubtype`, and the
   "DUT has no declaration" `ArgumentException` goes. A **non-null subtype on a non-DUT kind** breaks the driver
   contract and is refused (`InvalidOperationException`, naming the item), the same way `UnsupportedIn` refuses a
   reason without its line. The non-source path (`ReadManifest`) never names a DUT.
4. **The extension table.** `ItemKind.SourceKindExtensions` gains `(Kinds.Dut, "dut")` as a fifth DUT row. That gives
   `KindForWireName("X.dut") == dut`, a writable source in `FileExtensions` and so in the CLI's `Extensions`
   registry, the DUT family in `PushedText.MayBeHeldAs`, and the create-collision check in `PushConflicts` (it
   matches any DUT name). Creating an item takes `Kinds.Dut → PlcDut` (`PushService` ~1448) for any DUT name, so
   `create X.dut` takes the same driver path as `create X.struct` (TwinCAT 606 seed, CODESYS `create_dut(Structure)`),
   and the text is then written as sent. `ExtFor(Kinds.Dut)` still throws: a DUT still has more than one extension.
5. **Push: bare DUT identity, proven by version (5.B.3).** In `PushConflicts`, an unforced `set` whose name is a DUT
   name NOT in the version map resolves to the live DUT of the same bare name under its published name (`.dut` or a
   subtype; there is at most one, since one object has one identity). Its `ifVersion` is compared with THAT item's
   version: equal → accepted as an update; different → `STALE_ITEM_VERSION` with the live version, so the client
   pulls. It is never `ITEM_MISSING`. The version hashes the folder and the text, not the name, so an equal version
   proves the client's file holds that exact content. Apply resolves by bare name already, and the re-type guard sees
   DUT = DUT. `RequireUnchanged` re-hashes the live content, which is name-free. The receipt names the item by the
   IDE's answer after the write, and the CLI's `HeldUnderAnotherName` records the rename (DUT family). A `set X.dut
   → X.enum` (a git rename) and a `delete X.dut` + `set X.enum` pair already go through `DutSubtypeChanges`
   unchanged: the rename lands on bare `X`, and the pair is coalesced because the extensions differ.
6. **Pull (5.B.3).** No CLI code. The baseline holds `E_Mode.dut`, refs publish `E_Mode.enum`, the removal sweep
   retires the old name, fetch writes the new one, and git records a rename (`DutSubtypeFileTests`' shape for
   `.struct → .enum`). The reverse (`.enum → .dut` after the IDE text breaks) is the same.
7. **Interim driver answer, until 5.C and 5.D.** Both drivers implement the field in 5.B through one engine stand-in,
   `CodeHelper.TryDutSubtype(declaration)`: today's `DutSubtype`, answering null where it throws now. It is called
   ONLY from the two drivers' `ReadContent` (below the seam), and its comment names the change that replaces it.
   5.D swaps CODESYS to the signature's `Flags`, 5.C swaps TwinCAT to the total classifier, and 5.F deletes the
   stand-in, guarded by 5.F.2's gate. Until then the two ✗ rows above are known interim disagreements, listed here
   and nowhere hidden.
8. **FakeIde.** `Item` gains `DutSubtype? DutAnswer`. The fake must state what its vendor answers, not derive it on
   read. Authoring derives it once from the declaration (`TextualPou`, the same rule and legitimacy as
   `CodeForDeclaration`), through a test-side helper in `test/shared` (not `CodeHelper`, which 5.F deletes). A
   `WriteContent` to a DUT re-answers from the written text through the same helper, which models both vendors'
   answer following the text at once: CODESYS's signature (C2g), and TwinCAT's text-pure classifier (5.A.2). A test
   pins a vendor answer with `DutAnswers[name] = …`, `null` included. 5.F.2's gate scans `src/`, and the test helper
   is fixture authoring.

### Counted fallbacks

**One: `.dut`, for a DUT whose subtype the vendor does not state.** Named here, triggered by the 5.B.1 red tests
(FakeIde answer null → `X.dut`; answer `Enum` → `X.enum`; the same bare name, folder and version), and counted. It is
0 of 8175 corpus DUTs, and 4 recorded fixture shapes (the table above, every one of which declares nothing). No other
default is introduced. A non-DUT with a subtype, or a DUT op that would need a guessed name, is refused.

### What stays refused, by name

- **A name with no kind** (`X`, `X.foo`): `RequireWireNames`, unchanged. `.dut` now HAS a kind, so it leaves that
  list, and its message no longer cites `X.dut` as the example.
- **A delete whose name is not the live name**: unchanged. `NamesThisItem` still compares the op's name with the
  materialized one, so `delete X.dut` over a live `X.enum` is a no-op, forced or not. A delete cannot be undone, and
  5.B.3 widens only `set`, where the version proves the content.
- **Another family over a DUT** (`X.fb` / `X.gvl` over DUT `X`): the re-type guard, unchanged.
- **A create of any DUT name over a live DUT of the same bare name** (`create X.dut` over `X.enum`, and the reverse):
  `ITEM_EXISTS`, naming the live name (the existing sibling check now matches `.dut` too).
- **Two ops on one DUT** other than a rename or a delete + create pair: `DutSubtypeChanges`, unchanged. `.dut` counts
  as a subtype name.
- **A DUT whose content cannot be read at all** (COM error, driver throw): `unreadable` + `--force`, unchanged. Only
  "no subtype stated" stops being unreadable.

### Migration

1. **Red first.** `Volt.Engine.Tests`: the `Materialize` tests for null / each subtype / a non-DUT with a subtype
   (refused), and `PushConflicts`/`PushService` tests for `set X.dut` over `X.enum` (equal version accepted, stale →
   `STALE_ITEM_VERSION`, no `ITEM_MISSING`), `create X.dut` over `X.enum` (`ITEM_EXISTS`), `delete X.dut` over
   `X.enum` (no-op), and a create of `X.dut` written as sent. `Volt.Cli.Tests`: a pull rename `.dut → .enum` and back,
   a push of `E_Mode.dut` with the IDE answering `.enum` (no conflict, the file renamed through
   `HeldUnderAnotherName`), and `Extensions.IsTrackedPath/IsPushable("X.dut")`. The tests assert against FakeIde
   answers, never against a text read.
2. **Engine.** `DutSubtype` enum, `ItemContent.DutSubtype`, the `.dut` table row, `ItemKind.DutExtension`,
   `FullWireName`, and `PushConflicts`' bare-DUT resolution for an update. `CodeHelper.TryDutSubtype` (the interim) is
   called by the drivers only. `LibSignatureRenderer.Dut` keeps `CodeHelper.DutSubtype` until 5.D.2.
3. **Drivers.** `CodesysDriver.ReadContent` and `BeckhoffDriver.ReadContent` set `DutSubtype` for a DUT kind, through
   the interim.
4. **Docs and comments that say "there is no `dut` extension" are rewritten:** `ItemKind.cs` (the table and
   `ExtFor`), `Materializer.cs`, `RefsFetch.cs`, `PushService.RequireWireNames`, `Sidecar.RefuseUnknownNames`,
   `source-extensions.ts`, and volt-control `files.ts`. `docs/wire.html` and `items.html` are regenerated
   (`VOLT_WRITE_DOCS=1`, gated by `DocDataTests`).
5. **Parity sites (`bun run check`):** `packages/volt-lsp-iec/src/source-extensions.ts` and `source-object.ts`
   (`".dut": "dut"`; a DUT text that does not open with TYPE declares nothing, the 4.2(a) rule, so a `.dut` that
   declares nothing reports nothing on the LSP either); `packages/volt-control/src/state/files.ts`; and
   `packages/volt-vscode`'s `languages[structured-text].extensions`, tmLanguage `fileTypes`, `volt-icons.json`
   `fileExtensions` and the `workspaceContains` glob.
6. **Tests whose premise the owner decision changed, so they change and say so in their summary:**
   `DutSubtypeFileTests` ("no file is named `.dut`"), `ExtensionListTextTests`, `ItemKindTests`, and
   **`DutBaselineMigrationTests`**. A baseline key `X.dut` from before `dut-subtype-on-the-wire` (archived
   2026-09-28) can no longer be told apart from a current `.dut` name, so `RefuseUnknownNames` stops refusing it.
   That stays safe: an `ifVersion` such a key quotes reaches the live DUT only if it equals that DUT's content
   version (choice 5), and the next pull renames the key. The e2e `held: "unreadable"` DUT rows move in 5.F.3, not
   here.

### Implemented (2026-10-02) — where reality refined the choice

Built as chosen (B1, choices 1–8). Three refinements, none changing a choice:

- **At the CLI, an answer that changed before the push meets the project lease first.** `expectedProjectVersion` hashes
  the published NAMES, so when the IDE's answer for `E_Mode` moves from `.dut` to `.enum` between a pull and a push,
  `volt push` is held by the ordinary lease ("the IDE changed since your last sync — run `volt pull` first"), never by a
  DUT refusal. The pull then carries a local edit of `E_Mode.dut` through git's rename into `E_Mode.enum`, and the push
  lands — no `--force` at any step (`DutSubtypeFileTests.An_edit_of_dot_dut_while_the_ide_fixed_it_follows_the_rename…`).
  Choice 5's bare-identity gate is what the wire guarantees (`DutBareIdentityPushTests`, over the pipe
  `DutNameTransportTests`): it serves any client that quotes the item version without a stale lease, and the CLI meets
  it when its own push makes the IDE re-answer (`E_Mode.dut` pushed with fixed text, receipt `E_Mode.enum`, recorded
  through `HeldUnderAnotherName`, renamed by the next pull). Making the lease name-free was not done: it guards renames
  too, and is not this step's to change.
- **The fake re-answers on both write transports.** `FakeIde.Item.DutAnswer` is a record property initialised from the
  declaration at construction (authoring); `WriteContent` AND the declaration-aspect `WriteText` re-answer from the
  written text; `DutAnswers[name]` pins any answer, null included.
- **`ItemContent.DutSubtype` is a documented format exception** (`ItemContentIsFullyCarriedTests.NotCarried`): the answer
  travels as the wire name's extension, never in the text — B1's own rule, now held by the gate that lists every field.

Counted fallback, measured on the code that ships (both drivers through the interim `CodeHelper.TryDutSubtype`): over
the six corpora **8175 DUT files, 0 published `.dut`, 0 whose answer disagrees with the file's extension**
(awa-palletizer 1738, bakon-nano 1784, CodesysTestProject 168, lenze-mid 2344, pro2193 2127, twincat-project14 14).
The fixture rows are the table above (4 written-as-sent shapes → `.dut`; `pwh_prose_then_struct` the listed interim
`struct`).

## Step 5.C — TwinCAT: one total DUT-subtype classifier in the driver, on the shared trivia skipper

> **Superseded by step 5.P and never built** (owner, 2026-10-02). Its WIP is kept outside the repo and is not to be
> revived. The `StTrivia` token view it designed is 5.E's to decide on its own merits (the child splitter).

(2026-10-02. Design only; no code. Tasks 5.C.1–5.C.3. 5.A.2 settled that TwinCAT needs this: no text-free source of
the subtype is always right there (C2e, C2h). CODESYS gets its answer from the signature in 5.D and has no classifier.)

### Target

`BeckhoffDriver.DutSubtypeOf` stops calling the engine stand-in `CodeHelper.TryDutSubtype`. It calls ONE function in
`Volt.Ide.Twincat` instead, `TcDutSubtype.Classify(string declaration) → DutSubtype?`. That function:

1. **Is total.** Every string maps to exactly one answer, `Struct | Enum | Union | Alias` or null (published `name.dut`).
   It never throws, and anything it cannot classify with certainty is null, never a guessed subtype.
2. **Agrees with the vendor.** Its oracle is CODESYS's precompile signature on the same text (TwinCAT runs the same
   3S compiler core, C2h). Over every corpus DUT, every fixture DUT, every table row and a fuzz set, it is **never a
   subtype CODESYS denies** (hard 0). It is null where CODESYS answers only on shapes named below, each counted.
3. **Reads trivia through the ONE skipper** that the child splitter also uses (5.E). There is no second copy, and that
   skipper is the one that matches the vendors on nested comments (measured below).

### Measured (2026-10-02)

**The corpora do not separate the options.** Scratch prototypes (`c5/proto.py`, `c5/census.py` in the session
scratchpad, not the repo) ran each candidate over the 8175 DUT files of the six corpora. These are **304 project DUTs**
(awa 18, bakon 44, lenze 74, pro2193 154, twincat-project14 14) plus 7871 library DUTs that `LibSignatureRenderer`
wrote (1957 distinct texts once the name is normalised). **Every option below agrees with every file's extension**
(8175/8175, 0 null). The census shows why: real DUT heads are plain. Counted over the 8175 files:

| shape | files | shape | files |
|---|---|---|---|
| body keyword on the line after `TYPE X :` | 7790 | `TYPE X : STRUCT` on one line | 2 |
| `//` comment before `TYPE` | 44 | pragma before `TYPE` | 98 |
| trivia between `:` and the body (`Gonio_Settings`) | 2 | trivia between `TYPE`, name and `:` | 0 |
| nested `(* (* *) *)` anywhere | 2 (bodies) | unclosed `(*` | 0 |
| conditional pragma (`{IF …}`) anywhere | 0 | lower/mixed-case keyword | 17 |
| `EXTENDS` | 11 (all one base) | `EXTENDS A, B` | 0 |
| enum with base type / with initial values | 33 / 1727 | attribute inside an enum | 0 |
| alias: subrange / `POINTER TO` / `ARRAY` / `STRING(n)` / other | 39 / 45 / 13 / 22 / 301 | `REFERENCE TO` alias | 0 |
| several types in one TYPE block | 0 | TYPE without END_TYPE | 0 |
| BOM / CRLF in the file | 0 / 0 (pulled files are LF) | tabs / trailing spaces | 7178 / 63 |

**The fixtures and the recorded build separate them.** The 4145 fixtures hold 253 DUT texts (13 pushed as sent).
Options differ only on these, and the vendor facts that decide them are already recorded:

| text (fixture) | vendor fact (recording) | S0 stand-in | C1 strict | **C5 chosen** |
|---|---|---|---|---|
| `pwh_prose_then_struct` (prose, then a valid STRUCT) | both builds: declares nothing (`Unknown type`) | `struct` ✗ | null ✓ | null ✓ |
| `unit_type_no_body` (`TYPE X :` / `END_TYPE`) | CODESYS signature `Type`+`Alias` (C2g); TwinCAT reloads it as 623 alias (C2h) | null ✗ | null ✗ | `alias` ✓ |
| `unit_type_missing_colon` (`TYPE X` / `STRUCT …`) | both builds: `': or EXTENDS' expected instead of 'STRUCT'` | `alias` ✗ | null | null |
| `unit_struct_extends_list` (`EXTENDS A, B :`) | both builds: `':' expected instead of ','` | `struct` | `struct` | null |
| `pwh_unclosed_comment_*`, `pwh_empty_struct`, `pwh_prose_struct` | signature `None` (C2g) | null ✓ | null ✓ | null ✓ |
| `pwh_struct_text_is_enum`, `pwh_enum_text_is_struct`, `pwh_struct_missing_semicolon`, `pwh_struct_then_prose`, `pwh_struct_member_implementation` | signature `Enum` / `Structure` ×4 (body errors do not change it: `badmember` is `Structure`, C2g) | ✓ | ✓ | ✓ |
| the other 237 fixture DUT texts | build as the shape they state | ✓ | ✓ | ✓ |

**Both vendors nest block comments.** `lex_nested_block_comment` (`(* outer (* inner *) n := 99; still inside *)`)
builds clean on CODESYS and on TwinCAT. A scanner that does not nest would read `n := 99;` as code. So would a
classifier on it: `(* a (* b *) TYPE X : STRUCT …` answers `struct` (S0 and C3 do) where the vendor sees one unclosed
comment and answers `None`. Two scanners exist in the engine today. `CodeHelper.CodeOn` skips LEADING trivia per line
and does NOT nest (its own doc says so). It is what the splitter (`StReader.ScanContext`) and the stand-in use.
`StTrivia` nests, blanks strings and pragmas, and is what the boundary rules use. Only `StTrivia` is right.

**Everything else in 5.C.2's table has no vendor answer yet**: comments between every two head tokens, conditional
pragmas, an unclosed pragma, a BOM, `TYPE X : ;`, `TYPE X : 5;`, `X : STRUCT` with no `TYPE`, `TYPE X : STRUCT EXTENDS B`
(`unit_struct_extends_after_struct`: the build refuses it after the keyword), several types in one block, TYPE
without END_TYPE, `TYPE X :` at end of text. The design does not guess these. The recorder below answers them before
any classifier code is written.

### Options

**Grammar** (each measured in the table above):

| option | rule | verdict |
|---|---|---|
| S0. keep the stand-in | first colon anywhere, non-nesting `CodeOn`, any token-led rest | rejected: 2 wrong subtypes on recorded fixtures (`pwh_prose_then_struct`, `unit_type_missing_colon`), wrong under nesting |
| C1. strict head | `TYPE name [EXTENDS b {, b}] : X`, END_TYPE after the colon → null | rejected: `.dut` where both vendors say alias (`unit_type_no_body`), and it answers `struct` for an EXTENDS list both vendors refuse |
| C3. C1 on `CodeOn` | as C1, non-nesting trivia | rejected: wrong subtype when a nested comment hides the head |
| C4. C1 ignoring conditional pragmas | evaluates nothing, skips `{IF}` as trivia | rejected: which branch is live depends on defines the text does not hold, and TwinCAT's defines are not CODESYS's. Skipping them can answer the dead branch |
| **C5. strict head, single base, END_TYPE → alias** | below | **chosen**: right on every recorded row, 0 null on the corpora |

**Where the skipper lives** (5.C.1 says one skipper, shared with 5.E's splitter):

| option | verdict |
|---|---|
| **K1. `StTrivia` (Engine), made public, with a token cursor over its one scan loop** | **chosen.** It already nests. The engine's splitter and the TwinCAT driver both reference `Volt.Engine`. `InternalsVisibleTo` reaches only the test assemblies, so the class becomes `public` |
| K2. `CodeHelper.CodeOn` | rejected: does not nest (L3), line-leading only, so it cannot see a comment opened after code |
| K3. a tokenizer inside `Volt.Ide.Twincat` | rejected by 5.C.1 (a second copy); the splitter is in the engine and could not share it |
| K4. the LSP lexer | rejected: another process and language; Volt's C# engine never calls into it |

**Oracle for 5.C.3:**

| option | verdict |
|---|---|
| **G1. a recording of CODESYS's signature for every case text** | **chosen**: the vendor's own answer per text, the oracle 5.A.2 named |
| G2. the corpus file extensions | rejected: Volt's own text read minted them (circular), and they say nothing about fuzz cases |
| G3. the build recordings | used as a cross-check only: they say "declares nothing" or "builds", never the subtype |
| G4. TwinCAT's own `ItemType` after a reload / its caption | rejected as oracle (owner, 5.A.2): the caption cannot tell alias from nothing, and a reload is minutes per batch. 5.G.1 checks TwinCAT live |

### Choice

1. **The skipper: `StTrivia`, one scan loop, two views.** The loop that builds `OpenAtStart`/`Code`/`Openings`/`Unclosed`
   is refactored into a state machine that also yields a lazy token stream. The new public view is
   `StTrivia.Tokens(string text)`, which yields `StToken(Kind, Text, Line, Column)` with `Kind` one of:
   - `Code`: an identifier, a number or one punctuation character;
   - `Pragma`: the whole `{…}`, yielded rather than dropped, so a caller can see `{IF`;
   - `UnclosedComment`: the last token, when a `(*` never closes.

   Comments (nested `(* *)`, `//`) and strings are skipped as they are now. A BOM at offset 0 is trivia, which is
   `CodeOn`'s rule moved into the one skipper. The existing array views are unchanged, so their callers
   (`ImplementationMarker`, `NetworkText`, `StReader`'s unclosed checks) see no change. 5.E moves the splitter
   (`ScanContext`, `FirstCodeLine`, `FirstMemberLine`, `BackOverMemberTrivia`) and `StDeclaration` off `CodeOn` onto
   this stream, and deletes `CodeOn`. Until then `CodeOn` stays, documented as 5.E's to remove. The 5.F.2 allow-list
   names `StTrivia` and the classifier.
2. **The classifier: `Volt.Ide.Twincat/Driver/TcDutSubtype.cs`**, `internal static DutSubtype? Classify(string
   declaration)`. It reads code tokens, stopping at the body token (a whole body is never scanned):
   `TYPE name [EXTENDS base] : X`, keywords in any case, `base` possibly dotted (`Lib.T`). Then X decides:
   - `STRUCT` → Struct, `UNION` → Union, `(` → Enum;
   - `END_TYPE` → Alias (CODESYS's own reading, C2g; TwinCAT reloads it 623, C2h);
   - any other identifier-led token (`INT`, `ARRAY`, `POINTER`, `REFERENCE`, `STRING`, a user type) → Alias.

   **Everything else is null**:
   - the first token is not `TYPE` (prose, a POU or GVL text, an unclosed comment, an empty text);
   - a missing name or colon;
   - a second `EXTENDS` base (`,`);
   - a number, punctuation, a string or the end of text where X stands;
   - a `Pragma` token whose body starts with `IF`/`ELSIF`/`ELSE`/`END_IF` anywhere before X;
   - an `UnclosedComment` before X.

   Other pragmas (`{attribute …}`) are trivia anywhere in the head. Totality is structural: no index is read without a
   bounds check and no parse throws. The fuzz test proves it.
3. **No answer for a shape → the recording decides before code.** The rows with no vendor answer today (listed under
   Measured) are recorded in the first batch. The rule above is adjusted only in one direction: a row where CODESYS
   answers None or another subtype becomes null in the classifier (narrowing is always possible, so a wrong subtype is
   never an accepted loss). A row where CODESYS answers a subtype and the classifier says null is fixed if the fix
   stays inside the head grammar. Otherwise it is listed in "Counted nulls" as `niche: accepted loss (N occurrences in
   the corpora)`. Several types in one block is decided this way: the first type's subtype if CODESYS agrees,
   otherwise null by a top-level scan for a second `name :` (0 occurrences).
4. **The case set and the recording (5.C.3).**
   - **Inputs:** `packages/volt-cli/test/dut-subtype/cases.json`, generated by `packages/volt-cli/scripts/dut-subtype-cases.ts`
     (bun; it can import the TS fixtures and read the corpora). Each case is `{ id, origin, text }` with `origin` one of
     `table:<row>`, `corpus:<path>`, `fixture:<name>` or `fuzz:<seed-id>:<mutation>`. Fuzz takes every project and fixture
     DUT and applies a fixed-seed PRNG mutation at each head-token gap and each head offset: insert `(* c *)`,
     `(* (* n *) *)`, an unclosed `(*`, a `// c` line, `{attribute 'x'}`, `{IF defined(X)}`, or truncate there; also case
     flips, CRLF and BOM. A deterministic sample of 2000 is recorded. The full generated set (tens of thousands) runs
     offline for "never throws". The table rows (5.C.2) are authored in that script with their reason text, so a row
     has one home. `volt-cli`'s `bun test test/unit` regenerates the file and fails on drift.
   - **Recorder:** `packages/volt-cli/scripts/record-dut-subtype.ps1` + `.py` (IronPython, `--runscript`). It starts its
     OWN CODESYS SP21 on a scratch copy of `CodesysTestProject.project`, with a timeout on every wait, and never stops a
     process it did not start. It creates one DUT per case (`create_dut(Structure)` + `textual_declaration.replace`,
     the C2g seed-independence makes the seed irrelevant), reads `GetSignature`, and deletes it. It writes
     `test/dut-subtype/codesys.json` as `{ casesSha, recorded, answers: { id: { pouType, flags } } }`. Distinct texts
     are deduplicated, about 4.5k signatures. The run time has not been measured; the probe made 20 in seconds, and
     the recorder logs per-case ms. One batch per change of `cases.json`, `RECORD_ONLY=<ids>` for a partial re-run.
   - **Mapping:** `Type`+`Structure` → Struct, `Type`+`Structure, Union` → Union, `Type`+`Alias` → Alias,
     `VarGlobal`+`Enum` → Enum, `None` → null. Any other combination fails the gate by name (vendor contract, as in
     step 5's refusal list). `HasErrors` is ignored (C2g).
5. **Tests, in `Volt.Ide.Twincat.Tests`.**
   - `TcDutSubtypeTableTests`: one `[Theory]` row per table case. The expected value is the recorded CODESYS answer,
     except rows listed as counted nulls, which assert null and name their reason.
   - `TcDutSubtypeAgreementTests`: every recorded case. It asserts 0 cases where the classifier answers a subtype
     CODESYS does not, and 0 nulls outside the counted list. The `.dut` cases are printed with their origin. On
     corpus and fixture DUTs that build, the `.dut` count must be 0. It fails loud if `casesSha` does not match
     `cases.json` (a stale recording).
   - `TcDutSubtypeFuzzTests`: the full generated set, offline. It never throws, and on recorded ids it is never a
     subtype CODESYS denies.

   `StTrivia.Tokens` gets its own table in `Volt.Engine.Tests`: nesting, `(*` in `//`, `//` in `(* *)`, a string
   holding `(*`, pragmas yielded, unclosed comment and unclosed pragma, BOM, CRLF.

### Counted nulls (`.dut` where the text has a subtype a human could read)

Named and counted now; the recording may add rows under choice 3, never silently:

- **A conditional pragma in the head** (`{IF defined(X)}` around the body or a keyword): `niche: accepted loss (0
  occurrences in the corpora)` if CODESYS answers a subtype. Which branch is live depends on defines that are not in
  the text, so no text read can be certain.
- **An `EXTENDS` list** (`EXTENDS A, B`): both builds refuse the syntax. Null unless the recording shows CODESYS still
  answers `Structure`. In that case it is cheap to accept (a list of bases), and it is fixed rather than listed.

Not nulls (they are the vendor's own "no answer", counted by 5.B already): unclosed comment, empty, prose,
prose-then-TYPE, a POU or GVL text in a DUT object. On the corpora: 0 nulls.

### What stays refused, by name

- **A recording that does not match `cases.json`**: the agreement gate fails, naming the stale file. It never runs on
  an old oracle.
- **A signature outside the five mapped combinations**: the gate fails, naming the case. It is never mapped to a
  nearest subtype.
- **A classifier answer CODESYS denies**: no accepted-loss mark exists for this. The rule narrows to null instead.
- **TwinCAT's POU kind** is not this function's. It stays the tree code (C2f/C2h), and an untouchable POU stays 5.H's.
- **Library DUTs** are not this function's. `LibSignatureRenderer` writes their text from the signature (5.D.2). On
  TwinCAT, `TcLibrarySignatures` names a library `Type` with no subtype (C2h), so 5.D.2 must decide the TwinCAT library
  case from the signature's shape. That is recorded here as 5.D.2's open input, not solved by this classifier.

### Migration

1. **Cases and recording first (no product code).** Add `dut-subtype-cases.ts` with the 5.C.2 table rows, its drift
   unit test and `cases.json`. Run `record-dut-subtype.ps1` once (own CODESYS) and commit `codesys.json`. Settle every
   unknown row by choice 3 and write the outcome into this section ("Recorded").
2. **Red.** `TcDutSubtypeTableTests` / `AgreementTests` / `FuzzTests` against a `TcDutSubtype.Classify` that still
   forwards to `CodeHelper.TryDutSubtype`. Expected red: `pwh_prose_then_struct`, `unit_type_no_body`,
   `unit_type_missing_colon`, every nested-comment and `TYPE`-less fuzz case. `StTrivia.Tokens` tests red (no API).
3. **Skipper.** `StTrivia` becomes public, gets one state machine and the `Tokens` view, and strips a BOM. The array
   views stay byte-identical (their existing tests plus `ImplementationMarker`/`NetworkText` suites).
4. **Classifier.** `TcDutSubtype.Classify` on `StTrivia.Tokens`. `BeckhoffDriver.DutSubtypeOf` calls it.
   `CodeHelper.TryDutSubtype` stays, called by `CodesysDriver` alone, until 5.D replaces it and 5.F deletes it (its
   doc comment drops "5.C swaps TwinCAT"). `TcDutSubtypeReadTests` (5.B) keep their premise (the driver sets the field
   from its declaration). A row that pinned an interim answer changes only where the recording says so, and says so
   in its summary.
5. **Docs.** DIALECT C2h gains "How Volt relies on it: `TcDutSubtype.Classify`, proven against CODESYS's signature
   (`test/dut-subtype/codesys.json`)". Step 5.B's two TwinCAT interim rows above (`pwh_prose_then_struct`, `TYPE X :
   END_TYPE`) and the two unmeasured shapes are closed for TwinCAT and stay open for CODESYS until 5.D. `wire.html`
   `#dut-subtype` names the TwinCAT source (regenerated, `VOLT_WRITE_DOCS=1` if a generated table moves).
6. **FakeIde** keeps its test-side `DutAnswerFor`. `Volt.Engine.Tests` cannot reference the TwinCAT driver, and the
   fake models the vendor answer, not this classifier. Its two documented differences (`^TYPE name`,
   identifier-led token) already match C5. Its END_TYPE row is aligned to `alias` (CODESYS and C5) in the same commit.

## Step 5.P — Pivot: one DUT extension, `.dut`; the subtype leaves the wire, the contract, the CLI and the LSP

(2026-10-02. Design only; no code. Tasks 5.P.1–5.P.4. Owner decision, 2026-10-02: "keep it simple". The separate
extensions are not worth the parsing complexity, its risks and the `.dut` fallback beside them.)

### Target

Every DUT is published, stored, pushed and analysed as **`name.dut`**, on both vendors, always. The KIND (DUT) comes
from the IDE's object type, which both vendors keep apart from the text (5.A: CODESYS `IDUTObject` /
`ITextListEnumerationObject`; TwinCAT tree codes 605/606/607/623 all map to `Kinds.Dut`). So naming a DUT reads no
text and asks for no vendor parse. Nothing in Volt decides a DUT's subtype any more: the IDE and its build own it.
The LSP still reads a DUT's shape from its text, but that is analysis, not naming. After 5.P:

1. `ItemKind.SourceKindExtensions` has ONE DUT row, `(Kinds.Dut, "dut")`. `ExtFor(Kinds.Dut)` returns `"dut"` like
   every other kind (its DUT throw goes), and `Materializer.FullWireName` is `bare + "." + ExtFor(kind)` for every
   kind.
2. The contract carries no subtype: `ItemContent.DutSubtype` and `Volt.Engine.Item.DutSubtype` are gone.
3. A subtype change (a struct rewritten as an enum) is an ordinary content update of `X.dut`. There is no rename, no
   op normalisation and no bare-identity resolution.
4. `.struct` / `.enum` / `.union` / `.alias` are no longer extensions anywhere. A file named that way is a foreign
   file to every consumer, like `X.foo`.

### Measured against the recorded fixtures and the corpora (2026-10-02)

- **Corpora.** The six committed corpora (`packages/volt-lsp-iec/test-corpus`, 30,167 tracked files) hold **8175
  DUT files: 5524 `.struct`, 2060 `.enum`, 210 `.union`, 381 `.alias`, 0 `.dut`**. After 5.P all 8175 are `.dut`.
  Renaming them to `bare.dut` causes no collision: there are **0** case-insensitive duplicate (folder, bare name)
  pairs among them, and 0 existing `.dut` files. `expected-build.codesys.json` names no DUT file (0 hits), so no build
  expectation moves.
- **Recordings.** `codesys.build.json`, `codesys.run.json` and `twincat.build.json` are keyed by FIXTURE name. **0**
  item names with a subtype extension appear in them. The vendor's compile does not depend on the DUT's wire name.
  CODESYS keeps no kind outside the text (C2g: the creation seed is not retained). A push-create takes
  `Kinds.Dut → PlcDut` for any DUT name, which is the same driver path every time (TwinCAT seeds 606 whatever the
  body, C2e). So pushing a fixture as `X.dut` instead of `X.struct` cannot change a recorded answer, and **no
  re-record is needed**. 5.G.1 checks the live round trip.
- **Fixtures.** There are 4145 fixtures. 53 primary DUT fixtures state a subtype as their `kind` (`struct` 36, `enum`
  8, `alias` 6, `union` 3), and the fixtures hold 253 DUT texts in all, sibling units included. The recorder names a
  sibling DUT from the PARSER's body kind (`record-language.ts` `unitExt`, which throws on any other body kind) and a
  primary DUT from the fixture's `kind` (`KIND_EXT`). Both become `dut`, and the throw goes, because nothing is read to
  name a DUT.
- **LSP analysis already ignores the DUT extension.** `source-object.ts` maps all five DUT extensions to the one
  object `"dut"`, and `workspace-refs.ts` crawls by `SOURCE_EXTENSION_SET`. No check reads a DUT's subtype from its
  file name. So the rename leaves diagnostics, symbols and the transpiler unchanged. Only these move: the extension
  tables, the fixture kinds, the library-element regex in `fixture-units.ts`, and the DUT-name scripts (`held-as.ts`,
  `record-language.ts`).
- **What the split names cost today** (the code 5.P deletes):
  - `DutSubtypeChanges.cs` (153 lines) and `DutSubtype.cs`;
  - `CodeHelper.DutSubtype` / `TryDutSubtype` / `DutSubtypeOrNull`, and `ItemKind.DutExtension`;
  - the `FullWireName` subtype branch and its contract refusal;
  - `PushConflicts`' bare-DUT resolution (`LiveDut` and the two `IsDut` arms);
  - in `PushService`, the `Normalize` call and `UnreadableDut` (2 sites). `NamesThisItem` has to MATERIALIZE a DUT to
    compare names, so deleting a DUT reads its content and can fail on that read;
  - both drivers' `DutSubtypeOf`;
  - the `CodeHelper.DutSubtype(text)` call in `LibSignatureRenderer.Dut`;
  - 12 test files (2918 lines) whose whole subject is the subtype name.

  With one extension, `NamesThisItem` is a kind comparison for every kind, so a DUT delete makes 0 content reads
  instead of 1.

### Options

| option | what it does | measured | verdict |
|---|---|---|---|
| **P1. `.dut` only; the subtype is removed from the wire, the contract, the CLI and the LSP** | one DUT row, no subtype anywhere | 8175/8175 corpus DUTs `.dut`; 0 recording changes; 0 collisions; deletes the code listed above | **chosen** |
| P2. keep 5.B and make both drivers answer null | every DUT is published `.dut` through the "no answer" branch | the same names as P1 | rejected: it leaves a contract field nobody sets, four dead extensions, and `DutSubtypeChanges` and the bare-identity path still live. That is the legacy 5.F forbids, and a future driver could start answering a subtype again |
| P3. `.dut` on the wire, with the subtype kept on `ItemContent` (or in a `refs` side map) for the editor's icons | the driver still classifies | needs the 5.C classifier or the CODESYS signature again | rejected: it brings back exactly the parse the owner dropped, and nothing needs it (the LSP reads the text) |
| P4. accept the split names as legacy aliases on push and pull | `.struct` etc. still map to `Kinds.Dut` on input | — | rejected: no backward compatibility (owner: nobody uses the split names yet; PLCAssist follows the wire names and is told). Two spellings of one item is the collapse the item-name invariant forbids |

**Migrating the committed data:**

| option | verdict |
|---|---|
| **R1. `git mv` every corpus DUT file to `bare.dut`** (one scripted commit, contents untouched) | **chosen.** The name is now a pure function of the kind (`bare + ".dut"`), and every one of the 8175 files is a DUT by its old extension, so the rename gives exactly the name a re-pull would. It causes no collision (measured). Verified by the LSP corpus suite (numbers unchanged) and `bun run check` |
| R2. re-pull the six corpora from live IDEs | rejected: it takes hours on both vendors, and a re-pull also brings every unrelated drift since the last pull into the same commit, so the rename could not be reviewed as a rename |

### Choice

**P1 with R1.** Every DUT is `name.dut`, and no code reads, carries or spells a subtype. The one counted fallback of
5.B disappears with it: `.dut` is no longer the exception for "no answer", it is the DUT's only name. Step 5's
acceptance ("`.dut` count 0 on compiled DUTs") is replaced by "every DUT is `.dut`, on every corpus, every fixture and
every live 5.G shape", which is 8175/8175 on the corpora.

- **CODESYS text-list enum** (`ITextListEnumerationObject`): Volt classifies it as `PlcDut` today (`CodesysTypeMap`
  line 63) and writes it through its `Interface` aspect. C2e measured this through the bridge: struct, union and alias
  were written in place, and the guid and interface were kept. That behaviour stays unchanged under `X.dut`: it is a
  writable DUT, read and pushed like any other. 5.P.1 re-checks it with a test row, and nothing makes it read-only.
- **Library DUTs**: `LibSignatureRenderer` keeps rendering the TEXT from the signature (the shape from `Flags`) and
  names the file `X.dut`. 5.C's open input (a TwinCAT library `Type` with no subtype flag) is now a question about
  rendering the text, not about naming, and stays as it is today.
- **Editor**: `volt-icons.json` loses the per-subtype icons and keeps one DUT icon for `.dut`. The owner accepted this
  with the decision.

### What stays refused, by name

- **A name with no kind** (`X`, `X.foo`), which now includes `X.struct` / `X.enum` / `X.union` / `X.alias`.
  `RequireWireNames` refuses them `BAD_REQUEST`, and `Sidecar.RefuseUnknownNames` refuses such a baseline key. The
  refusal message no longer says "a DUT by its subtype". A workspace that still holds split-name files sees them as
  foreign files and `name.dut` as added on its next pull. That is plain git, with no migration code (5.P.3).
- **Another family over a DUT** (`X.fb` / `X.gvl` over DUT `X`): the re-type guard, unchanged.
- **A create of `X.dut` over a live DUT `X`**: `ITEM_EXISTS`, from the ordinary create check (no sibling scan any
  more).
- **Two ops on one DUT in one push**: the ordinary duplicate-op rule every item has. The DUT-specific pairing rules of
  `DutSubtypeChanges` go (rename/pair coalescing, "body-less subtype rename"), because there is no subtype rename to
  pair.
- **A DUT whose content cannot be read at all** (COM error, driver throw): `unreadable` + `--force`, unchanged. One
  difference: a delete of `X.dut` no longer reads content to decide whether it names the item (it compares kinds
  only). So an unreadable DUT can be deleted by its name, like an unreadable POU, under the generic unreadable rule,
  and `UnreadableDut` goes.
- **Nothing refuses a DUT's TEXT.** A text that declares nothing is pushed as sent, and the build reports it.

### Migration

1. **5.P.1: the table, in every parity site at once (`bun run check` green).**
   - C#: `ItemKind.SourceKindExtensions` gets one DUT row, `ExtFor` becomes total, and `DutExtension` is deleted.
   - LSP: `source-extensions.ts` and `source-object.ts` keep `.dut` only.
   - volt-control: `state/files.ts`.
   - volt-vscode: `languages[structured-text].extensions`, tmLanguage `fileTypes`, `volt-icons.json` and
     `workspaceContains`.
   - The Claude Code plugin's `extensionToLanguage` site.
   - A test row for the text-list enum.
2. **5.P.2: engine and drivers.**
   - Deleted:
     - `DutSubtype`, and `ItemContent.DutSubtype` (with its `ItemContentIsFullyCarriedTests.NotCarried` exception);
     - `CodeHelper.DutSubtype` / `TryDutSubtype` / `DutSubtypeOrNull`;
     - `DutSubtypeChanges`, with its `Normalize` call;
     - `PushConflicts.LiveDut` and its two arms;
     - `UnreadableDut` and the DUT branch of `NamesThisItem`;
     - both drivers' `DutSubtypeOf`;
     - `FakeIde.Item.DutAnswer` / `DutAnswers` / `DutAnswerFor`.
   - `LibSignatureRenderer.Dut` returns `.dut`.
   - Test files deleted because their subject is gone: `DutSubtypeChangePushTests`, `DutBareIdentityPushTests`,
     `DutSubtypeAnswerTests`, `DutSubtypeCodeTests`, `CodesysDutSubtypeReadTests`, `TcDutSubtypeReadTests`,
     `DutNameTransportTests`, `LibraryDutExtensionParityTests`.
   - Tests rewritten to `.dut` where their subject is something else (`IdeTreeTests`, `PullCommandTests`,
     `PartialWalkTests`, `PushServiceTests`, `BlackBoxTests`, `TransportMatrixTests`, `ItemKindTests`,
     `WireVocabularyGuardTests`, `DocDataTests`, …). Each says in its summary that the owner changed the premise.
   - New tests, red first:
     - a struct→enum text change of `X.dut` is one content update, and the name does not change;
     - `X.struct` is refused `BAD_REQUEST`;
     - a delete of an unreadable DUT by `X.dut` takes the generic unreadable path.
3. **5.P.3: CLI.** `DutSubtypeFileTests` and `DutBaselineMigrationTests` are deleted, and so is `Sidecar`'s `X.dut`
   note. The black-box tests at both layers name DUTs `.dut`. No migration code.
4. **5.P.4: LSP.** Touch only the extension tables, fixture kinds, fixture names and DUT-name scripts. The LSP queue's
   uncommitted work in `src/analysis` and `src/frontend` is not this step's.
   - The fixture `kind` union: the four subtypes become `"dut"` (53 fixtures, `types.ts`).
   - `record-language.ts`: `KIND_EXT` and `unitExt` give `dut` for every `type_decl`, and the subtype throw is
     deleted.
   - `held-as.ts`: FAMILY keeps `dut` only.
   - `fixture-units.ts`: the library regex becomes `\.(fun|fb|itf|dut)$`.
   - The R1 corpus `git mv` (8175 files, one commit).
   - `bun run rate:fixtures`, if the map shows kinds.

   Conformance numbers must stay identical: the same diagnostics, on renamed files.
5. **Docs.**
   - `docs/items.html` and `wire.html`: the DUT section gets one extension, and `#dut-subtype` and `#dut-migration`
     are removed. The generated data is regenerated (`VOLT_WRITE_DOCS=1`, gated by `DocDataTests`).
   - DIALECT C2e/C2g/C2h keep their vendor facts. Their "How Volt relies on it" now says Volt no longer reads a DUT's
     subtype.
   - `volt-lsp-iec/README.md`, `docs/behavior.md`, `volt-vscode/README.md` and `volt-web/app/docs/agents.mdx`.
   - Comments in `RefsFetch.cs`, `Removal.cs`, `PushedText.cs`, `BeckhoffDriver.Tree.cs` and `FetchService.cs`.
   - The probe logs under `volt-cli/scripts` are history and stay.

   After this, 5.F.2's gate forbids `.struct` / `.enum` / `.union` / `.alias` as an extension in source.
