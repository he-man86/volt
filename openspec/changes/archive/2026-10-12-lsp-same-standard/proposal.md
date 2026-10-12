## Why

The owner (2026-10-11): "make sure everything is up to the same standard". `transpile-restructure` (archived 2026-10-11)
set the standard for `packages/volt-lsp-iec`: a review per area with root causes fixed test-first, one home per concern,
file and function size limits (400 / 600 test / 80 per function), clean layering, strict citations, no dead exports,
every behaviour pinned by a recorded fixture. Only `src/transpile` is held to it. Measured 2026-10-11 (HEAD abdaac2ae2),
running the transpile gates over all of `src/`:

- **Size:** 19 source files over 400 lines (`syntax/network/parser.ts` 1372, `parse/statements.ts` 901, `ast/nodes.ts`
  892, `analysis/messages.ts` 830, `types/const/fold.ts` 704, `lex/lexer.ts` 685, `server/server.ts` 624, …), 3 colocated
  test files over 600, and `test/` support files far over (`test/frontend/rules.ts` 4629, `support/divergences.ts` 1779,
  `notes/lean.data.ts` 1455, `bound-census.ts` 1378, `baseline/baseline.ts` 1041).
- **Functions:** 25 over 80 lines — `lex` 566, `runServer` 486, `messagesFor` 335, `checkCall` 273,
  `parseTypeExpression` 229, `parsePrimary` 170, …
- **Dead exports:** 72 under `src/` (frontend 53, transpile 9, services 4, server 3, reference 2, workspace 1).
- **Never reviewed:** `services/`, `server/`, `reference/`, `workspace/`. `frontend-conformance` named "the rest of the
  LSP review (analysis, services, server)"; `analysis-conformance` did analysis, nothing did the rest.
- **Files in the wrong folder** (`lsp-package-structure` gated folders, not files): `server/` holds dead-code
  reachability (an analysis), the workspace index (`workspace/` exists beside it) and a test client (`harness.ts`, used
  only by `server/*.test.ts`); `reference/` mixes a language fact (the pragma attribute catalog, read by a diagnostic)
  with hover text read only by services, and its docs row is stale. Its built-in hover coverage is unmeasured
  ("curated, not exhaustive").

**Out of scope, by standing rule:** network text (`frontend/syntax/network/*`, `analysis/checks/network/*`,
`services/network/*`) is not refactored until the LD/FBD design. It gets ceilings at today's size (may not grow) and its
splits are handed to the LD/FBD coverage change.

## What Changes

- **The gates cover the whole package.** `check-size.ts` scope `src` (and `test/` support), today's oversize files as
  shrink-only ceilings that end empty except the network-text ones; the function limit a failure once its list is empty;
  `dead-exports` over `src` in lint, at 0 (or a documented barrel surface).
- **Review per area, transpile-style,** for the never-reviewed areas — `services/` (assist, formatting, navigation,
  structure, shared), `server/`, `workspace/`: findings against the LSP behaviour tests and the recorded fixtures, root
  causes fixed test-first, each finding fixed or filed.
- **Files in the folder of what they are:** `server/` only the LSP adapter; reachability → `analysis/`; the workspace
  index → `workspace/`; `harness.ts` → `test/`; `reference/` dissolved (attribute catalog → `frontend/`, hover catalog →
  `services/assist/`); every built-in has hover (test).
- **Splits, output-neutral:** every oversize file and long function outside network text split by concern (the lexer by
  token class, the parsers by construct, `messages.ts` by check group, `const/fold.ts` by operator family, `runServer` by
  request group, …); `test/` support files split by topic.

## Impact

`packages/volt-lsp-iec` only; output-neutral (fixture map, recordings and LSP behaviour tests unchanged) except the
hover entries added and any finding fixed test-first. No wire change.
