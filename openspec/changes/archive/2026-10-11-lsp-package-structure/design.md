## Inventory (task 0.1, measured 2026-10-11 at `6d856b66a3`)

`packages/volt-lsp-iec`, after E.1/E.2 and the archived `frontend-conformance`, `analysis-conformance` and
`transpile-restructure`:

- **`src/` top level** — eight folders and six loose files. The folders `frontend/` (syntax · symbols · types · library),
  `analysis/`, `services/`, `transpile/`, `reference/` and `server/` are layers, ranked in `scripts/check-layering.ts`.
  Two are by LANGUAGE, not layer: `network-text/` (the LD/FBD lexer, parser, AST and value walks; imported by
  `network/`, `services/structure/{folding,semantic-tokens}.ts` and `test/corpus/corpus.test.ts`) and `network/` (wire
  scope + types `network-analyze.ts`, the diagnostics `network-analysis.ts`, the services `network-services.ts`, the
  outline `network-symbols.ts`, a barrel; imported by `server/{server,diagnostics}.ts`, `src/index.ts`,
  `test/analysis/census.ts`, `test/conformance/support/{replay,evidence}.ts`, `scripts/frontend-snapshot.ts`). Loose:
  `index.ts` (the package barrel, `package.json` `exports`), `bin.ts` (the CLI entry, `package.json` `bin`, compiled by
  `scripts/build-payload.ts` and bundled by `volt-vscode`'s build; `dist/src/bin.js` is the dev path of `volt-desktop`,
  `volt-vscode`, `volt-control`'s e2e and the wiring check), `workspace-refs.ts` (the workspace scan; server, scripts,
  test support), `source-extensions.ts` (the writable-source set; server, workspace scan, the wiring check, two C#
  repo gates) and their tests, plus `build.test.ts` (the published build compiles — a package test, not a module's).
- **Measured layer breaks** the moves must respect: `network-text/parser.ts` imports `frontend/types` (the operators'
  typing rule types a wire: `operatorFunctionResult`, `isBitOperatorWireType`, `BIT_OPERATOR_FUNCTIONS`), so it cannot
  sit in `syntax/` as is; `network/network-analysis.ts` imports `services/shared` for the type `Document` alone, so it
  cannot sit in `analysis/` as is; `services/structure/semantic-tokens.ts → network/network-analyze.ts` is the one
  `KNOWN_OTHER_VIOLATIONS` entry.
- **`test/`** — the cross-cutting root already: `conformance/`, `corpus/`, `catalog/`, `libraries/`, and the two
  layer measures `frontend/` and `analysis/`, plus the preload `network-text-on.ts` (`bunfig.toml`). Two files sit in
  the wrong concern: `frontend/baseline.ts` (+ its test) is the baseline discipline BOTH measures use, and
  `frontend/layering.test.ts` runs the package's layering gate. `frontend/{sources,dumps,bound}.ts` stay: the front-end
  snapshot loads them by path from older commits too.
- **`scripts/`** — 38 files, every one in `scripts/README.md` and every one named by package.json, a doc, a test or
  another script, except `probe-projectsettings-effect.ts`: kept by E.1 only because the analysis-conformance tasks
  named it, and that change is archived.
- **`docs/`** — current since E.2; `architecture.md`'s tree is "as it stands" with loose files and the two network
  folders.

## Target tree (task 1.1)

One sentence per folder is `docs/architecture.md` "The tree", held to the disk by `test/package/structure.test.ts`.

**Old → new**

| Old | New |
|---|---|
| `src/network-text/{lexer,ast,exprs,parser}.ts` | `src/frontend/syntax/network/` — exported through `syntax/index.ts` |
| `src/network-text/{parser,implementation-line}.test.ts` | `src/frontend/types/network/network-{parse,implementation-line}.test.ts` |
| `src/network/network-analyze.ts` | `src/frontend/types/network/network-analyze.ts` — exported through `types/index.ts` |
| `src/network/network-analysis.ts` | `src/analysis/checks/network/network-analysis.ts` (+ a colocated test, A6) — exported through `analysis/index.ts` |
| `src/network/network-{services,symbols}.ts`, their tests | `src/services/network/` — exported through `services/index.ts` |
| `src/network/index.ts` | deleted (each layer's barrel carries its part) |
| `src/bin.ts` | `src/server/bin.ts` (`dist/src/server/bin.js`) |
| `src/{workspace-refs,source-extensions}.ts` + tests | `src/workspace/` (the rank `workspace` already had) |
| `src/build.test.ts`, `test/frontend/layering.test.ts` | `test/package/` with the new `structure.test.ts` |
| `test/frontend/baseline{,.test}.ts` | `test/baseline/` |
| `scripts/probe-projectsettings-effect.ts` | deleted (single-use, its change archived) |

**Choices**

- **The network reader types its wires through a parameter.** `syntax/network/parser.ts` `readNetworkText` takes a
  `NetworkWireTyping` (the operators' rule); `types/network/network-parse.ts` `parseNetworkText` passes the types
  layer's own (`operatorFunctionResult`, `isBitOperatorWireType`) and is the one every caller uses. Same port shape as
  `NetworkScopeView`; no fact is copied into syntax. `BIT_OPERATOR_FUNCTIONS.has(x)` becomes "the rule says ANY_BIT",
  the same set.
- **`computeNetworkTextDiagnostics` moves, it is not made a registry check.** Turning it into `checkNetworkText` run by
  the registry changes output (config, TwinCAT dedupe, `quiet()` reach network findings) — that is the LD/FBD coverage
  change's (tasks.md hand-in). It takes the `{ uri, parseResult }` it reads instead of the services' `Document`.
- **`src/index.ts` stays** — the package barrel `package.json` exports; the gate allows exactly it at `src/`'s top.
- **`services/network/`, `analysis/checks/network/`, `frontend/{syntax,types}/network/`**: the network part of each
  layer is a folder inside the layer (the owner's `analysis/checks/network/`), never a root.
