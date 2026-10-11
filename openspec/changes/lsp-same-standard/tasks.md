## 0. Measure

- [ ] 0.1 The census at HEAD: every file over its limit, every function over 80, every dead export, per area, with the
      network-text ones marked out of scope. Every `src/server/*`, `src/reference/*`, `src/workspace/*` file: what it is,
      who imports it, its target folder. Built-in hover coverage vs `ELEMENTARY_TYPES` + `BUILTIN_RESULT` + conversions.
- [ ] 0.2 design.md: the target per oversize file / long function (split by what), the folder moves, the review plan
      per area. Design first, then code.

## 1. Gates first (red where the code is not there yet)

- [ ] 1.1 `check-size.ts` scope `src` + `test/` support, today's oversize files as shrink-only ceilings (network-text
      ones marked "LD/FBD change"); `dead-exports` over `src` in lint with today's list as a shrink-only allowlist.
- [ ] 1.2 Structure gate (`test/package/structure.test.ts`): no `src/` file is test support; `server/` imports only the
      indexes it dispatches through.

## 2. Folders (output-neutral)

- [ ] 2.1 `server/`: reachability + dead-code equivalence → `analysis/`; `workspace-store.ts` → `workspace/`;
      `harness.ts` → `test/` support; `server/` = server, bin, config, index, diagnostics, diagnostic-codes.
- [ ] 2.2 `reference/` dissolved: attribute catalog → `frontend/` (beside pragma syntax), hover catalog →
      `services/assist/`; `check-layering.ts` reference rank and rule A1 updated; `src/index.ts` exports stable.
- [ ] 2.3 Every built-in has a hover entry (missing ones added); a test asserts it.

## 3. Review (services, server, workspace)

- [ ] 3.1 Review `services/` per area (assist, formatting, navigation, structure, shared) and `server/` + `workspace/`
      against the LSP behaviour tests and recorded fixtures: findings with severity and root cause.
- [ ] 3.2 Every finding fixed test-first, or filed with a reason; no LSP-only diagnostic introduced (parity rule).

## 4. Splits (output-neutral)

- [ ] 4.1 frontend: the lexer (`lex` by token class), the parsers (statements, expression, type-expr, declarations,
      units), `ast/nodes.ts`, `pragmas/conditional.ts`, `types/const/fold.ts`, `types/infer/expr.ts`,
      `symbols/scope-nav.ts`, `symbols/binder.ts`, `lex/vocabulary.ts` — each within 400, every function within 80.
- [ ] 4.2 analysis: `messages.ts` by check group, `checks/calls/call-arguments.ts`, the long check functions
      (`checkPragmas`, `checkHeaderRules`, `checkIntrinsicOperands`, `checkUnresolvedIdentifiers`, `operandSignWarnings`,
      `checkOneCase`).
- [ ] 4.3 server + services: `runServer` by request group, `services/formatting/print.ts`; the transpile leftover
      `lower/storage/layout.ts` `buildLayout`.
- [ ] 4.4 Tests: colocated tests over 600 split by subject; `test/` support files split by topic.
- [ ] 4.5 Dead exports at 0 (or the documented barrel surface); the size ceilings empty except network text; the function
      limit a failure.

## 5. Close

- [ ] 5.1 `docs/architecture.md` (tree, layers, the reference row), `test/README.md`, `scripts/README.md` current.
- [ ] 5.2 Network-text ceilings and their splits handed to the LD/FBD coverage change (memory note, and a line in its
      proposal when it is created).
- [ ] 5.3 `bun typecheck`, lint (layering, size, citations, dead exports) green, full suite cold green, fixture map
      unchanged except hover. Archive.
