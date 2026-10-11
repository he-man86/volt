## 0. Measure

- [ ] 0.1 Every `src/server/*` and `src/reference/*` file: what it is, who imports it (src and test), its target folder
      per the proposal. The built-in hover coverage: entries vs `ELEMENTARY_TYPES` + `BUILTIN_RESULT` + the conversions,
      the missing names listed.

## 1. server/

- [ ] 1.1 `reachability.ts` + `dead-code-equivalence.ts` → `analysis/` (own folder), docs say what it is (an analysis
      the server uses for suppression); tests move with them.
- [ ] 1.2 `workspace-store.ts` → `workspace/`.
- [ ] 1.3 `harness.ts` → `test/` support; its six `server/*.test.ts` importers follow.
- [ ] 1.4 `server/` holds only the adapter (server, bin, config, index, diagnostics, diagnostic-codes) and its tests.

## 2. reference/

- [ ] 2.1 `pragmas.ts`'s attribute catalog → `frontend/` beside the pragma syntax (a language fact analysis reads).
- [ ] 2.2 The hover catalog → `services/assist/`; `reference/` deleted; `check-layering.ts`'s `reference` rank and rule
      A1 removed or rewritten; `src/index.ts` exports kept stable for consumers.
- [ ] 2.3 Every built-in from 0.1 has a hover entry (missing ones added from the CODESYS reference text the catalog
      already uses); a test asserts it.

## 3. Gate and close

- [ ] 3.1 `test/package/structure.test.ts`: no `src/` file is test support, and none is imported only by tests; `server/`
      imports only the indexes it dispatches through. Red before 1.3.
- [ ] 3.2 `docs/architecture.md` (tree, layer list, the reference row) and `test/README.md` updated.
- [ ] 3.3 `bun typecheck`, lint (layering, size, citations), full suite `VOLT_REQUIRE_FULL=1` green; output-neutral
      (fixture map unchanged except hover). Archive.
