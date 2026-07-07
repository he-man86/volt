## 1. Export the hierarchy providers

- [x] 1.1 Export `prepareCallHierarchy`, `callIncoming`, `callOutgoing`, `prepareTypeHierarchy`, `typeSupertypes`, `typeSubtypes` (+ `HierItem`/`CallRef` types) via `src/services/navigation/index.ts` → `src/services/index.ts`.

## 2. Wire call hierarchy

- [x] 2.1 Declare `callHierarchyProvider: true` in the `initialize` capabilities.
- [x] 2.2 Register `textDocument/prepareCallHierarchy` → `prepareCallHierarchy`, adapting `HierItem` to `CallHierarchyItem`.
- [x] 2.3 Register `callHierarchy/incomingCalls` (re-resolve the item, run `callIncoming`, adapt `CallRef` → `{from, fromRanges}`) and `callHierarchy/outgoingCalls` (`callOutgoing` → `{to, fromRanges}`).

## 3. Wire type hierarchy

- [x] 3.1 Declare `typeHierarchyProvider: true`.
- [x] 3.2 Register `textDocument/prepareTypeHierarchy` → `prepareTypeHierarchy` (`HierItem` → `TypeHierarchyItem`).
- [x] 3.3 Register `typeHierarchy/supertypes` → `typeSupertypes` and `typeHierarchy/subtypes` → `typeSubtypes` (over the store's workspace docs).

## 4. workspaceSymbol

- [x] 4.1 New `src/services/structure/workspace-symbol.ts`: iterate the project `Scope` top-level symbols, filter by the query (case-insensitive substring), emit `SymbolInformation` via the existing `lspSymbolKind` mapping.
- [x] 4.2 Declare `workspaceSymbolProvider: true`; register `workspace/symbol` → the new service.

## 5. Tests

- [x] 5.1 Type-aware incoming calls: `A.Step()` reported, unrelated `B.Step()` not.
- [x] 5.2 Outgoing calls list both callees with ranges.
- [x] 5.3 Supertypes return EXTENDS base + IMPLEMENTS interfaces.
- [x] 5.4 Subtypes span two files.
- [x] 5.5 workspaceSymbol finds a DUT in an unopened file (with the eager index) and narrows by query.
- [x] 5.6 Adapter shapes match the LSP types (item fields; incoming `from`/`fromRanges`, outgoing `to`/`fromRanges`).

## 6. Docs

- [x] 6.1 No package README exists (design-of-record is `openspec/specs/st-language-server/`); the new capabilities are declared in `server.ts` and specified in this change's spec delta (call hierarchy / type hierarchy / workspace symbol), synced to the main spec on archive. The layer map already lists hierarchy under E/navigation.
