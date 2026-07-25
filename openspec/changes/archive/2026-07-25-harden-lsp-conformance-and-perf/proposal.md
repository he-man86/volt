## Why

Two real problems surfaced from live use, both of a kind our current tests miss.

**Protocol-behavior bugs slip through.** The LSP shipped diagnostics **twice** on every edit — it declared *pull*
diagnostics (`diagnosticProvider`) yet also *pushed* via `publishDiagnostics`, and a pull-capable client (VS Code)
does both. We had 33 server tests driving a real client, but none exercised the *interaction* of client
capabilities, so the duplicate went unnoticed. Same class: the emitted diagnostic `code` was our internal slug
(`inout-own-access`) instead of the CODESYS `C0371` users recognise — no test asserted the wire-level identity of
a diagnostic. These are behaviors the unit/conformance layers can't see because they test the analysis output
(`DiagnosticItem`), not the *LSP responses a client actually receives*.

**Diagnostics and go-to-definition are slow.** `WorkspaceStore.project()` caches the whole-project symbol table,
but **every** document change calls `invalidate()`, so the next request rebuilds `buildSymbolTable(docs())` over
the *entire* project — O(project size) per keystroke. Every diagnostic, definition, hover, and completion blocks
on that rebuild. There is no benchmark, so the cost is invisible and unbounded.

Both are systemic: we need tests that catch protocol-behavior regressions automatically, and a measured,
incremental indexing path so the LSP stays responsive on real projects.

## What Changes

**A. LSP behavior-conformance test layer** (`test/lsp/`) — drives the running server as a real client and asserts
the *responses*, closing the gap the analysis tests can't:
- A **client-capability matrix**: push-only, pull-only, push+pull, ±refresh support → assert the correct channel
  fires and NEVER both (the duplicate-diagnostics invariant), and that config changes reach each client kind.
- **Diagnostic-identity invariants**, checked over synthetic docs and the corpus: no two diagnostics share the
  same `(range, code)` (no duplicates); every semantic diagnostic's `code` is the CODESYS `Cnnnn` (or a documented
  exception — VG_*/parse); the `codeDescription` link resolves. These run headless, no live IDE.
- **Response golden checks** for the core navigations (definition/hover/references) so their wire shape is pinned.

**B. Incremental indexing + a perf gate:**
- Replace the all-or-nothing `invalidate()` with a **per-file symbol index**: re-index only the changed file(s)
  and re-link cross-file references, instead of rebuilding the whole project. `project()` stays a cheap view.
- Add `test/lsp/bench` — a latency benchmark for diagnostics + definition on the largest corpus project, printing
  p50/p95, with a **budget assertion** (a request over budget fails, mirroring "a timeout is a bug, not a budget").
- Profile first, optimize the measured hotspot, prove it with the benchmark before/after.

## Impact

- New: `packages/volt-lsp-iec/test/lsp/` (behavior-conformance + bench). Additive test surface.
- Changed: `src/server/workspace-store.ts` (incremental index) and possibly `src/symbols/` (per-file index API).
  Behavior-preserving — the existing unit/conformance/corpus gates must stay green.
- No change to the wire protocol, the bridge, or the product; this hardens correctness + speed of the LSP only.
- A new CI-runnable gate (behavior-conformance) and a local/opt-in bench (needs no live IDE).
