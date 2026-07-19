## Why

Volt names every writable source item by its KIND: `.fb/.prg/.fun/.itf/.gvl` for POUs, and **four**
extensions for the DUT variants — `.struct/.enum/.union/.alias` — backed by **four wire kinds**
(`structure`/`enumeration`/`union`/`alias`). But a DUT is **not four object types** in either IDE:
CODESYS and TwinCAT both model it as a single "DUT" object (TwinCAT reports *every* DUT as `TREEITEMTYPE`
623; CODESYS classifies one `IDUTObject`). The struct/enum/alias distinction is something Volt *derives*.

Tracing the drivers shows the four-way split is **pure cost** — struct/enum/union/alias is not a Volt
concept at all; it lives only in the declaration text, and the IDE derives it from that text on both read
and create:

- **Both drivers pay an extra per-DUT declaration COM read on every walk** purely to refine the subkind.
  TwinCAT's own code says so: *"Only a DUT pays the extra decl read."* Its only consumer is `ExtFor`
  picking one of four extensions.
- **Two independent DUT sub-classifiers** exist and must agree byte-for-byte or the bridges diverge:
  CODESYS's `RefineDut` and the shared `DetectDutSubType`. A duplicated parity hazard.
- **TwinCAT already creates every DUT with one code (623)** and lets the written declaration define the
  subtype; CODESYS's `create_dut` takes a `DutType`, but — like a function's seeded `return_type` —
  `WriteSourceText` writes the real `TYPE…END_TYPE` and CODESYS re-derives the subtype from it, so one
  neutral create call suffices.

Collapsing the DUT to a single **kind + extension** (`.dut` — the native extension in CODESYS `.dut` and
TwinCAT `.TcDUT`) removes the read-path refinement on both drivers, deletes **both** classifiers, drops
the create-side subkind entirely, and shrinks the extension/kind list in every layer (CLI, LSP, VS Code,
opencode-config, control). Volt never picks a subkind anywhere. Safe by construction — a DUT name is
unique in the project **type namespace**, so four extensions collapsing to one can never file-collide.

> **Verification gate:** the "CODESYS re-derives the subtype from the written declaration" assumption is
> the one thing not confirmable off-IDE. It MUST be verified against a headless CODESYS project (create an
> enum/union/alias `.dut` via push, confirm the IDE materializes the right DUT category) before this ships.

## What Changes

- **BREAKING (wire + workspace):** the four DUT wire kinds collapse to a single `dut`, materialized as a
  single `.dut` extension. Read-side subkind refinement is removed from both drivers. Because the wire
  item **name includes the extension**, a bound workspace re-materializes the DUTs on the next pull
  (`Foo.struct` → `Foo.dut`). One-time churn, no data loss — `structureVersion` hashes bare names
  (unchanged). No backward compat (no users yet): the old extensions/kinds simply stop being recognized.
- **The subkind is removed entirely — Volt never picks one.** Create maps `dut` → one code (`PlcDut`);
  the IDE derives struct/enum/union/alias from the written declaration. `DetectDutSubType`, `RefineDut`,
  and TwinCAT's per-DUT `KindCode`/`DutCode` refinement are all deleted.
- **Bridge simplification (shared Core — parity preserved automatically):**
  - `ItemKind`: one `PlcDut` code (623); `Map(PlcDut) → "dut"`; `ExtFor("dut") → "dut"`;
    `IsSourceKind`/`IsTopLevelCrud` list one `dut` arm. The 605/606/607 constants are deleted.
  - CODESYS `CodesysTypeMap`: `IDUTObject`/`ITextListEnumerationObject` → `PlcDut`; `RefineDut` and the
    DUT arm of `NeedsDeclaration` removed (no per-DUT Interface-aspect read on the walk).
  - TwinCAT `BeckhoffDriver`: `ClassifiedKind` returns the raw code (623 for a DUT); `DutCode` and the
    extra `ReadDeclaration`/`ParseCodeHeader` per DUT are removed.
  - CODESYS `CodesysObjectModel`: one `create_dut` call (neutral Structure skeleton); the four DutType
    cases collapse to one.
  - `CodeHelper.ParseCodeHeader` returns `"dut"` for a `TYPE`; `DetectDutSubType` is deleted.
  - `StSplitter`/`StAssembler`: the simple-block branch matches `"gvl" or "dut"` (was the four subkinds).
- **Consumers reduce four DUT entries to one `.dut`:** LSP `detect-vendor` `KIND_EXTENSIONS`; VS Code
  `package.json` language + activation glob; opencode-config LSP registration; volt-control's source-file
  set; the CLI scaffold (`.vscode/settings.json` + README table); doc/help strings.

## Impact

- **CLI (C#, shared Core):** `ItemKind`, `CodesysTypeMap`, `CodesysObjectModel` (one `create_dut`),
  `BeckhoffDriver.Tree`, `PushService` (`PouKindToCode`), `CodeHelper` (`ParseCodeHeader` → `dut`,
  `DetectDutSubType` deleted), `LibSignature(Renderer)` (library DUTs → `.dut`), `Scaffold`, `Commands`
  help, doc comments in `StSplitter`/`StAssembler`/`RefsFetch`, `docs/ITEM_KINDS.md`. No per-vendor code
  beyond the two driver deletions — both bridges stay byte-identical on the wire.
- **LSP (`volt-lsp-iec`):** `detect-vendor.ts`; `docs/behavior.md`, `docs/data-model.md`. Analysis
  unaffected (kind is parsed from content; the server keys off the `structured-text` language id).
- **VS Code (`volt-vscode`):** `package.json`, `src/lsp.ts` comment, `README.md`. Grammars follow the
  language id automatically.
- **opencode-config:** `opencode.json` LSP `extensions`; `tool/volt.ts`, `agent/volt.md`.
- **control:** `volt-control/src/state/files.ts` `EXTS` (+ `files.test.ts`).
- **Tests & fixtures:** C# tests asserting the four DUT kinds/exts; volt-cli e2e; LSP conformance/corpus;
  rename on-disk `test-corpus/**/*.{struct,enum,union,alias}` → `.dut`.
- **Migration:** bound workspaces re-materialize DUTs on next pull (native git delete+add). No custom step.

## Non-goals

- Not touching POU/GVL/interface extensions, read-only graphical (`.cfc`/`.sfc`), or opaque reference kinds.
- No dual-extension / dual-kind back-compat (no users yet): `.struct/.enum/.union/.alias` and the four
  wire kinds stop being recognized (clean break; re-pull regenerates `.dut`).
- The `test-corpus/` is re-pulled fresh (it was removed to regenerate with correct datatypes), so it
  materializes `.dut` naturally — no in-place corpus rename is part of this change.
