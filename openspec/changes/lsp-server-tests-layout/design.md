## 1.1 The map (measured 2026-10-12 at 44dd466bad)

Before: 17 test files under `src/server/`, 100 `test(` definitions. Each test went to the file it exercises:

| was | test(s) | now |
|---|---|---|
| `server.test.ts` | initialize advertises capabilities; hierarchy + workspaceSymbol providers; capability↔handler parity | `server.test.ts` (`server.ts` owns `CAPABILITIES` and the wiring) |
| `server.test.ts` | hover | `handlers/assist.test.ts` |
| `server.test.ts` | definition | `handlers/navigation.test.ts` |
| `server.test.ts` | documentSymbol; semanticTokens range, delta; workspaceSymbol | `handlers/structure.test.ts` |
| `server.test.ts` | "structural requests respond" (selection, folding, tokens, codeLens) | split by handler: structure (selection, folding, tokens) + assist (codeLens) |
| `server.test.ts` | "assist requests respond" (signatureHelp, typeDefinition, implementation, inlayHint, codeAction, formatting) | split by handler: assist (signatureHelp, inlayHint, codeAction), navigation (typeDefinition, implementation), formatting (formatting) |
| `server-diagnostics.test.ts` | the four PUSH tests (didOpen pushes, a pull client gets none, network text pushed, dead FB suppressed) | `state.test.ts` (`ServerState.pushDiagnostics`) |
| `server-diagnostics.test.ts` | the eight PULL tests (document + workspace diagnostic, manifests, older/newer Volt) | `handlers/diagnostics.test.ts` |
| `server-documents.test.ts` | unopened sibling resolves (the crawl); diagnostics gated until indexed | `state.test.ts` (`reindex`, `indexed`) |
| `server-documents.test.ts` | didChange/didClose; open buffer over disk; watched create, delete; closed file stays indexed; open+disk once; didSave | `handlers/documents.test.ts` |
| `server-documents.test.ts` | didChangeConfiguration live-toggle | `handlers/lifecycle.test.ts` |
| `server-navigation.test.ts` | hover in network text; completion | `handlers/assist.test.ts` |
| `server-navigation.test.ts` | references + highlight; rename; call hierarchy ×2; type hierarchy | `handlers/navigation.test.ts` |
| `rename.test.ts` (finding R6) | both | `handlers/navigation.test.ts`, `describe` naming the finding |
| `ranges.test.ts` (finding R7b) | range clamp (semantic tokens range, inlay hints) | `handlers/structure.test.ts`, `describe` naming the finding |
| `on-type-formatting.test.ts` (finding R2) | both | `handlers/formatting.test.ts`, `describe` naming the finding |
| `watched-files.test.ts` (finding R3) | the watcher globs | `handlers/lifecycle.test.ts`, `describe` naming the finding |
| `network-text-switch.test.ts` | "the suite runs with the switch on" | `config.test.ts` (`NETWORK_TEXT_ENABLED`) |
| `network-text-switch.test.ts` (rest), `bench`, `navigation-golden`, `capability-matrix`, `diagnostic-identity`, `implementation-keyword-diagnostics` | black-box protocol suites | `test/lsp/` |
| — | `bin.ts` had no test | `bin.test.ts`: `--version`, the exclusive flags refused, the usage (3 new) |
| `vendor.test.ts`, `diagnostics.test.ts` | already named after their file | unchanged |

`test/server/{harness,sources}.ts` moved to `test/lsp/` with the suites (task 2.3 asks for one root); `onceDiag` and
`notDefined`, which `state` and `documents` now both need, moved into `sources.ts`. After: 71 in `src/server/` + 35 in
`test/lsp/` = 106 (100 + the 3 from the two split tests + the 3 new `bin` tests). `index.ts` is a barrel and asks nothing:
the gate exempts it, as the test-support gate does.

Choice: a finding-named file merged into a handler's test keeps its finding as a `describe` around its tests (with its
header comment inside), so its constants stay its own and the finding stays readable in the test name.
