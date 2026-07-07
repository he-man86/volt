## Why

Two standard navigation surfaces are missing at the protocol edge even though most of the work is done. **Call and type hierarchy are fully implemented and unit-tested** (`services/navigation/hierarchy.ts` + `hierarchy.test.ts`) but never registered in `server.ts`, so they are dark to every client — a finished feature returning nothing. **workspaceSymbol** ("go to symbol in workspace") is absent entirely, though the project symbol table and the document-symbol → `SymbolInformation` mapping already exist. Both are standard LSP capabilities (`callHierarchyProvider`, `typeHierarchyProvider`, `workspaceSymbolProvider`) that every reference server ships.

## What Changes

- **Wire call hierarchy** — declare `callHierarchyProvider`, register `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, `callHierarchy/outgoingCalls`; thin adapters from the existing `HierItem`/`CallRef` to `CallHierarchyItem` / `CallHierarchyIncomingCall{from,fromRanges}` / `CallHierarchyOutgoingCall{to,fromRanges}`.
- **Wire type hierarchy** — declare `typeHierarchyProvider`, register `textDocument/prepareTypeHierarchy`, `typeHierarchy/supertypes`, `typeHierarchy/subtypes` over the existing `typeSupertypes`/`typeSubtypes`.
- **Add workspaceSymbol** — new `services/structure/workspace-symbol.ts` that queries the project `Scope`, reusing the document-symbol kind mapping (`symbol-kinds.ts`); declare `workspaceSymbolProvider`, register `workspace/symbol`.
- Export the hierarchy functions through `services/navigation/index.ts` → `services/index.ts` (they are currently unexported to `server.ts`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `st-language-server`: add requirements that the server exposes call hierarchy, type hierarchy, and workspace symbol search over the workspace.

## Impact

- **Code:** `src/server/server.ts` (six hierarchy handlers + `workspace/symbol` + three capability flags), `src/services/navigation/index.ts` + `src/services/index.ts` (exports), new `src/services/structure/workspace-symbol.ts`.
- **Dependency:** these are project-wide by nature — `callIncoming`/`typeSubtypes`/`workspaceSymbol` are only complete when the server holds the whole project, not just open docs. This change SHOULD land after `eager-workspace-index` (which supplies the store + full project scope); before it, results are limited to open documents (still correct, just partial). No dependency on `st-call-argument-check`.
- **No new algorithms:** hierarchy is pure wiring; workspaceSymbol reuses existing symbol/kind machinery.
