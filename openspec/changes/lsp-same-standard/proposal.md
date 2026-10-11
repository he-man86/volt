## Why

`lsp-package-structure` (archived 2026-10-11) put every folder of `packages/volt-lsp-iec/src` in a layer and gated
that; it did not check that each FILE is in the right folder. The owner (2026-10-11) named two folders that are not
fully covered:

- **`src/server/` (≈3900 lines) is half not-server.** The layer is the LSP process: the stdio connection, capability
  negotiation, dispatch to `services/`, publishing diagnostics. Beside that it holds:
  - `reachability.ts` + `dead-code-equivalence.ts` (≈400 lines): dead-code reachability over the PROGRAM — an analysis,
    called "server suppression policy" in `docs/architecture.md`, but nothing in it reads the connection;
  - `workspace-store.ts` (267): the workspace index (parse, build, relink per file) — `src/workspace/` exists beside it
    with `workspace-refs.ts`;
  - `harness.ts` (156): a TEST client that drives the server over in-process pipes — test-only code in `src/`,
    imported only by six `server/*.test.ts` files.
- **`src/reference/` (368 lines) is a folder for two unrelated things.** `reference.ts` is hover text for built-ins
  (one-liners; type ranges derived from `frontend/types`), consumed only by `services/assist` and
  `services/network`. `pragmas.ts` is a language fact — which `{attribute …}` names exist per dialect — read by
  `analysis/checks/pragmas` (a diagnostic) as well as by hover/completion. `docs/architecture.md` still describes the
  folder as "types, operators, conversions, pragmas, standard functions and FBs" — stale: library FBs are never there
  (by design) and types are derived. The catalog is "curated, not exhaustive" (its own `ponytail:`), so its coverage of
  the built-in set is unmeasured.

## What Changes

- `server/` keeps only the LSP adapter: `server.ts`, `bin.ts`, `config.ts`, `index.ts`, `diagnostics.ts`,
  `diagnostic-codes.ts`. Moved: reachability + dead-code equivalence → `analysis/` (their own folder there),
  `workspace-store.ts` → `workspace/`, `harness.ts` → `test/` support (no `src/` file is test support).
- `reference/` dissolves by what each part IS: the attribute catalog (a language fact) → `frontend/` beside the pragma
  syntax; the built-in hover catalog → `services/assist/` (its only consumers are services). The layering gate's
  `reference` rank and rule A1 go with it.
- Built-in hover coverage measured: every elementary type, operator and compiler-provided function (`types/builtins`
  `BUILTIN_RESULT`, `ELEMENTARY_TYPES`) has a hover entry, or the gap is listed and closed; the `ponytail:` "add as needs
  surface" is replaced by a test that every built-in has one.
- The structure gate (`test/package/structure.test.ts`) gains: no `src/` file is test support or imported only by
  tests; `server/` imports nothing from below `services` except the indexes it dispatches through.

## Impact

`packages/volt-lsp-iec` only (src/server, src/reference, src/analysis, src/workspace, src/frontend, src/services/assist,
test/, scripts/check-layering.ts, docs/architecture.md). Output-neutral except the hover entries added. No wire change.
