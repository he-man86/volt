## 1. Layout

- [ ] 1.1 Map every `src/server/**/*.test.ts` test (describe/test names) to the source file it exercises, or to
      "black-box protocol suite"; record the map and the test count before.
- [ ] 1.2 Structure gate first (red): every `server/` and `handlers/` source file has a colocated `<name>.test.ts`; no
      `src/server/**` test is named after anything but a source file beside it.
- [ ] 1.3 Move: handler tests beside their handler (`handlers/navigation.test.ts`, `assist.test.ts`, `documents.test.ts`,
      `lifecycle.test.ts`, `formatting.test.ts`, `diagnostics.test.ts`, `structure.test.ts`), the finding-named tests merged
      in; server-file tests beside `server.ts`, `state.ts`, `diagnostics.ts`, `vendor.ts`, `bin.ts`; the black-box suites
      to `test/lsp/`. Every test file gets a header saying what it covers. No assertion removed or weakened.
- [ ] 1.4 Test count equal or higher than 1.1's; `bun typecheck`, lint, full suite `VOLT_REQUIRE_FULL=1` green;
      `test/README.md` names `test/lsp/`. Archive.
