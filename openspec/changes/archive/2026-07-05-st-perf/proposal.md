## Why

On a large multi-file project the LSP re-does too much work per edit: `Workspace.invalidate()` is all-or-nothing (one edit re-parses everything), the `initialized` seed isn't batched (a big tree can block startup), and there's no performance budget guarding regressions. This phase makes interactive queries responsive on a large project. It inherits the performance work from `harden-lsp-real-project` (§5), which is otherwise superseded/landed.

## What Changes

- **Baseline measurement** — instrument `initialized` seed time, `getProjectScope` build time, and representative definition/references/hover/completion latency on the largest committed corpus (pro2193, 803 files).
- **Per-document symbol caching** — replace the all-or-nothing `Workspace.invalidate()` so an edit re-parses only the changed file and `getProjectScope` recomposes cached per-file symbols.
- **Batched `initialized` seed** — so a large project doesn't block startup.
- **Performance-budget assertion** — index-build + per-query thresholds in a test, so latency can't silently regress.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `language-server`: add the requirement (moved from `harden-lsp-real-project`) that interactive queries meet a performance budget on a large multi-file project, and that an edit invalidates only the changed document's symbols rather than the whole workspace.

## Impact

- **Code (volt-lsp-iec):** `workspace.ts` (per-document symbol cache, replacing `invalidate()`), `dispatch.ts` (batched seed), a perf test with budget assertions.
- **No wire/bridge impact.** Analyzer-internal.
- **Inherits** `harden-lsp-real-project` §5 (that change is being closed; its perf tasks live here).
