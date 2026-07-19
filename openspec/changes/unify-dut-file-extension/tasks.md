Collapse the DUT to a single wire kind `dut` + single `.dut` extension across all layers, and remove the
struct/enum/union/alias subkind concept ENTIRELY — Volt never classifies it (the IDE derives it from the
declaration on both read and create). No backward compat (no users yet).

## Bridge restructure (C# Core + drivers) — the heart of the change
- [x] `ItemKind`: delete `PlcDutEnum/Struct/Union` (605/606/607); keep one `PlcDut` (623). `Map(PlcDut) → "dut"`;
      `ExtFor("dut") → "dut"`; `IsSourceKind`/`IsTopLevelCrud` list one `dut`/`PlcDut` arm.
- [x] CODESYS `CodesysTypeMap`: `IDUTObject`/`ITextListEnumerationObject` → `PlcDut`; delete `RefineDut`; drop
      the DUT arm from `NeedsDeclaration` (no per-DUT Interface-aspect read on the walk).
- [x] CODESYS `CodesysObjectModel`: one `create_dut` call (neutral Structure skeleton) for `PlcDut`; the four
      DutType cases collapse to one — the declaration write reshapes it.
- [x] TwinCAT `BeckhoffDriver.Tree`: `ClassifiedKind` returns the raw code; delete `DutCode` and the extra
      `ReadDeclaration`/`ParseCodeHeader` per DUT.
- [x] `PushService.PouKindToCode`: `"dut" → PlcDut`; remove the struct/enum/union/alias arms and the
      create-time subkind derivation.
- [x] `CodeHelper`: `ParseCodeHeader` on a `TYPE` returns kind `"dut"`; delete `DetectDutSubType`.
- [x] `StSplitter` / `StAssembler`: simple-block branch matches `"gvl" or "dut"`; update the doc comment.
- [x] `LibSignature(Renderer)`: library DUTs render with `.dut` (STRUCT vs UNION body still chosen from `Flags`).
- [x] `docs/ITEM_KINDS.md`: one DUT code (623) `dut`; 605/606/607 marked unused/deleted.

## Parity / create verification (the load-bearing invariant)
- [x] Unit: every DUT variant (struct/enum/union/alias) creates with the single `PlcDut` code (PushServiceTests).
- [x] **HEADLESS CODESYS — VERIFIED (2026-07-19):** the whole e2e parity suite passed against a freshly-built
      bridge in headless CODESYS 3.5.21 (`codesys-pipe.ps1 up` + `VOLT_PIPE=volt.bridge.codesys bun test test/e2e`
      → **69 pass / 0 fail**), incl. the full create→fetch→edit→rename→move→delete lifecycle for struct/enum/
      union/alias `.dut`. Confirms `create_dut` (Structure skeleton) + declaration write re-derives the subtype.
- [ ] Live TwinCAT: same round-trip (native 623 create + declaration) for parity — **live run pending** (the
      dev pipe worker's project-binding needs the exact `VOLT_TC_PROJECT` name; unrelated to this change). Low
      risk: the create path is shared Core (unit-covered for both vendors), and TC natively models every DUT as
      623, so it derives the subtype from the declaration the same way CODESYS (the harder case) just did.

## CLI-side consumers
- [x] `Scaffold.cs`: `.vscode/settings.json` associations + README table use `.dut`.
- [x] `Commands.cs` help text: DUTs are `.dut`.
- [x] Doc comments in `StSplitter`/`StAssembler`/`RefsFetch` mentioning `.struct/…`.
- [x] `Extensions.cs` registry: four DUT entries → one `.dut` (rw).

## LSP (`volt-lsp-iec`)
- [x] `workspace-refs.ts` `SOURCE_EXTENSIONS` + `detect-vendor.ts` `KIND_EXTENSIONS` → `.dut`.
- [x] `docs/behavior.md`, `docs/data-model.md`, `README.md`.
- [x] Confirmed analysis is content-driven (internal type-model `kind: "struct"/"enum"` AST kinds untouched).

## VS Code (`volt-vscode`)
- [x] `package.json`: language `extensions`, `workspaceContains` glob; `syntax.tmLanguage.json` `fileTypes`.
- [x] `src/lsp.ts` comment; `README.md`.

## opencode-config
- [x] `opencode.json` LSP `extensions` → `.dut`; `agent/volt.md` mentions.

## control
- [x] `volt-control/src/state/files.ts` `EXTS` → `.dut`; `files.test.ts` (incl. negative assertions for old exts).

## Tests & fixtures
- [x] C# tests: `CodeHelperTests` (`dut` header), `LibSignatureRendererTests` (`.dut`), `FetchExclusionTests`
      (`HANDLE.dut`), `PushServiceTests` (one-code create), `FakeIde` (CreatedKinds hook).
- [x] volt-cli e2e (`fixtures`, `crud-cycle`, `top-level`, `harness`) — DUT kind `dut`, files `.dut`.
- [x] LSP conformance fixtures (`data-type`/`usage-pattern`/`pragma-tc` kind `dut`, `replay` extFor, `types`),
      corpus `ST_EXTS`, `server.test.ts`/`symbols.test.ts` filenames, `scripts/{corpus-fp,parser-completeness}`.
- [x] Corpus dropped from this change — `test-corpus/` re-pulled fresh (materializes `.dut` naturally).

## Final legacy scan — clean
- [x] `rg '\.(struct|enum|union|alias)\b'` (excl archive/corpus/bin/obj) returns only the `files.test.ts`
      negative assertions.
- [x] `rg 'PlcDutEnum|PlcDutStruct|PlcDutUnion|PlcDutAlias|DetectDutSubType|RefineDut|DutCode'` → zero.
- [x] `bun run typecheck` (all packages) + `bun run lint` (0 errors) + `dotnet test` (Core 280, CLI 79) +
      `bun test` (lsp 651 pass/0 fail, control 37/0). e2e + headless-CODESYS pending (need live IDE).
