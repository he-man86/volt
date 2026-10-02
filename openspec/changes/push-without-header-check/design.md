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
