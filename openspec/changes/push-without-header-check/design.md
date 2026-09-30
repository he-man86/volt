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
