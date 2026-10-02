# @volt/lsp-iec

> TypeScript-native language server for IEC 61131-3 Structured Text (CODESYS / TwinCAT), with the editable FBD/LD graphical bodies as a native sublanguage.

A single LSP 3.17 server that gives Structured Text navigation, diagnostics, completion, hover, signature
help, and semantic tokens — driven by an embedded CODESYS language reference. **It infers types to make its
diagnostics accurate, but it is not the type-checker:** the CODESYS/TwinCAT compiler stays authoritative for
final type-checking and codegen. Shipped as the bare-name `volt-lsp-iec` binary on `PATH`, which each host
registers through its own mechanism — the `volt-vscode` extension for the VS Code family, a plugin for
Claude Code.

## Role in Volt

```
live PLC IDE  ──HTTP──  bridge (C#)  ──HTTP wire──  volt-git (TS)  ──>  git repo of text files
 CODESYS / TwinCAT       per-vendor                  init/pull/push          analyzed by volt-lsp-iec
                                                     status/build/log         edited in volt-vscode
```

The LSP reads the kind-named source tree that `volt-bridge` materializes and `volt-git` reconciles — POUs
(`.fb`/`.prg`/`.fun`), DUTs (`.dut`, whatever their shape), `.itf`, `.gvl`, plus read-only library
signatures and `.device`/`.library` stubs — entirely offline. It never talks to the bridge at runtime; the
bridge/CLI own the on-disk layout, the LSP consumes it.

## How it works

The server is one vendor-neutral IEC engine with a runtime `vendor` setting (`--codesys` | `--twincat`); a
structurally different vendor (e.g. Siemens) would be a **sibling LSP**, not a new dialect inside this one.
Load-bearing invariants a maintainer must not break:

- **Zero false-positive ERRORs on valid real code.** A clean-*building* project must yield zero ERROR
  diagnostics from the LSP. Precision is measured over ERROR severity only — the compiler legitimately emits
  WARNINGs (e.g. implicit `LREAL→REAL` narrowing), so warnings are oracle-validated and reported separately,
  never ratcheted to zero.
- **Conservative & non-authoritative.** Type inference yields `UNKNOWN` whenever any step can't be resolved,
  and every consumer treats `UNKNOWN` as *skip* — an unresolved library symbol or unmodeled construct never
  produces a diagnostic. Dead (unreachable) code is suppressed by default (matching the compiler, which never
  compiles it); uncertain reachability resolves to *live*.
- **The conformance oracle is the live compiler, not "zero errors on the corpus".** Correctness is proven by
  recording each fixture against a live CODESYS/TwinCAT build and diffing the LSP's diagnostics byte-for-byte
  per vendor. The corpus is only a regression safety net: a miss it surfaces means *add a feature test*, not
  *tweak a threshold*.
- **Every body states its language, and that line alone picks the reader.** The line that ends a body's
  declaration is `IMPLEMENTATION ST|LD|FBD` (`src/frontend/syntax/format/implementation-line.ts`, mirroring the bridge's
  `ImplementationMarker`): `ST` goes to the ST parser, `LD`/`FBD` to the network-text path — its own grammar,
  parser, and analysis. Nothing sniffs the text (a `NETWORK` under `IMPLEMENTATION ST` is ST and an error). Code
  correctness (type inference, undeclared-variable, hover/nav) is LSP-owned; the network-text *format* and the
  vendor round-trip are bridge-owned. In a process without `VOLT_GRAPHICAL=1` nothing under an LD/FBD line is
  read (`server/config.ts` `NETWORK_TEXT_ENABLED`, passed to every server parse as `ParseOptions.networkText`), as
  the shipped bridge shows none.
- **A body Volt does not show is `IMPLEMENTATION <LANG> UNSUPPORTED`** — every CFC/SFC/IL body, and an LD/FBD body
  network text cannot spell — with nothing under it. Neither parser reads it; its declaration is analysed as
  usual and the hover on the line explains it. Code under the line, or a bare `IMPLEMENTATION CFC`, is a
  diagnostic, as the push refuses it.

## Build & test

```bash
cd packages/volt-lsp-iec        # tests can't run from repo root

bun typecheck                   # tsc --noEmit — src + test + scripts (this tsconfig, not a bare tsc)
bun test                        # all three layers, offline & deterministic
bun test src/frontend/types     # a single dir / module's unit tests
bun test test/conformance       # just the conformance replay
bun run build                   # tsc -> dist/ (also runs on prepare; bin is ./dist/src/bin.js)
bun run lint                    # the layer-boundary check (fails on an upward import)
```

The `record:language` / `refresh:corpus` / `audit:check` scripts (in `scripts/`) talk to a **live bridge** to
produce the recorded ground truth; they are run by hand, never by `bun test`. See [`TESTING.md`](./TESTING.md).

## Layout

Folders are layers; **imports point downward only** (the front-end `syntax ← symbols ← types` ← analysis ←
services ← server), lint-enforced. See [`docs/architecture.md`](./docs/architecture.md) for the full ownership map.

| Path | Layer / role |
|---|---|
| `src/bin.ts` | CLI entry — `--stdio [--codesys\|--twincat]` runs the server; `--version` prints it. |
| `src/frontend/syntax/` | the vocabulary · lexer (error-tolerant) · the complete AST · parser · literals · pragmas · the Volt file format. |
| `src/frontend/symbols/` | binder · scope-nav · `scoped-bodies` (the one shared "walk every ST body" iterator). |
| `src/frontend/types/` | elementary type facts · the `Type` model · resolve · const · infer · compat · arith · render. |
| `src/frontend/library/` | the Volt library format: path layout · manifest · materialization format. |
| `src/analysis/` | diagnostics orchestrator (vendor-keyed) · per-vendor messages · the `checks/`. |
| `src/services/` | navigation · hierarchy · hover/completion/signature-help · semantic-tokens · formatting · code-actions. |
| `src/reference/` · `src/network/` | language-data catalogs · the network-text (FBD/LD) sublanguage (reuses the shared core). |
| `src/server/` | LSP 3.17 over stdio · `WorkspaceStore` (eager index + watched-file freshness) · push+pull diagnostics. |
| `src/transpile/` | Rust backend — sibling consumer of the frontend for headless PLC-logic test execution. |
| `libraries/` | the library repo: each referenced library's elements written in ST, per version, for the transpiler (never the LSP). |
| `test/conformance/` · `test/corpus/` | oracle replay (LSP diagnostics, transpiler execution) · real-project ratchet. |

## Docs

- [`docs/architecture.md`](./docs/architecture.md) — **canonical** design: the layer stack, the build order, and the one-home-per-concern ownership map. Read before deep work.
- [`docs/behavior.md`](./docs/behavior.md) — the behavioral contracts (requirements + scenarios) the server guarantees.
- [`docs/data-model.md`](./docs/data-model.md) — the concrete types.
- [`docs/language-reference.md`](./docs/language-reference.md) — the IEC catalog + the CODESYS↔TwinCAT differences.
- [`TESTING.md`](./TESTING.md) — the three test layers and the live-bridge tooling.
- [`../volt-cli/docs/network-text.html`](../volt-cli/docs/network-text.html) — the network-text language the graphical path analyzes.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance.
