## Context

`services/navigation/hierarchy.ts` already implements `prepareCallHierarchy`, `callIncoming`, `callOutgoing`, `prepareTypeHierarchy`, `typeSupertypes`, `typeSubtypes` — all over the shared `resolveAt` / `resolveMemberChain` / `stBodies` helpers, with a passing `hierarchy.test.ts`. It is simply never imported by `server.ts`, so no capability is declared and no handler is registered. workspaceSymbol has no service yet, but `document-symbol.ts` + `symbol-kinds.ts` already map symbols to LSP `SymbolInformation`/kinds, and the project `Scope` enumerates every top-level symbol.

The LSP flows (3.17): call hierarchy is `textDocument/prepareCallHierarchy` → `callHierarchy/incomingCalls`/`outgoingCalls`; type hierarchy is `textDocument/prepareTypeHierarchy` → `typeHierarchy/supertypes`/`subtypes`; workspace symbol is `workspace/symbol`. The client re-sends the prepared item back on the follow-up calls, so the server must be able to re-resolve an item to its symbol.

## Goals / Non-Goals

**Goals:**
- Register the existing hierarchy providers with faithful LSP shapes; add workspaceSymbol.
- No duplicate algorithms — adapters + reuse only.

**Non-Goals:**
- Reworking hierarchy internals (they are done and tested).
- `resolveSupport` / lazy workspace-symbol resolution (return full `SymbolInformation` up front).
- Cross-project / multi-root search.

## Decisions

- **Hierarchy = adapters, no new logic.** `HierItem{name,kind,uri,range,selectionRange}` is already `CallHierarchyItem`/`TypeHierarchyItem`. `CallRef{item,ranges}` maps to `{from: item, fromRanges: ranges}` (incoming) / `{to: item, fromRanges: ranges}` (outgoing). Re-resolving the prepared item on the follow-up call: match the item's `uri` + `selectionRange` back to the document offset and call the same `prepareCallHierarchy`/`prepareTypeHierarchy` to recover the `Symbol`, then run `callIncoming`/`callOutgoing`/`typeSupertypes`/`typeSubtypes`. This keeps a single resolution path.
- **workspaceSymbol reuses the kind map.** New `services/structure/workspace-symbol.ts` iterates the project `Scope`'s top-level symbols, filters by the query (case-insensitive substring, matching document-symbol behavior), and emits `SymbolInformation` via the existing `lspSymbolKind` mapping — no second kind table.
- **Consumes the WorkspaceStore.** All three read `project()`/`workspace()` from the store (`eager-workspace-index`). That is what makes `incomingCalls`, `subtypes`, and `workspace/symbol` span the whole project rather than only open documents.

## Risks / Trade-offs

- **Partial results before eager indexing lands.** Without the store's disk layer, hierarchy/workspaceSymbol only see open docs (incomplete but correct). Hence the ordering: land after `eager-workspace-index`. Documented, not blocking.
- **Follow-up re-resolution by (uri, selectionRange).** If an item's file was edited between prepare and the follow-up, re-resolution may miss; acceptable (the client re-prepares) and no worse than other servers.
- **workspaceSymbol result size.** Iterating a large project's symbols per query is O(symbols); fine at PLC-project scale and matched to the query. Add a cap only if a real project shows a problem (measure first).
