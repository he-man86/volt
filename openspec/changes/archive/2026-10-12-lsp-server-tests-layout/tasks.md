## 1. Layout

- [x] 1.1 Map every `src/server/**/*.test.ts` test (describe/test names) to the source file it exercises, or to
      "black-box protocol suite"; record the map and the test count before.
- [x] 1.2 Structure gate first (red): every `server/` and `handlers/` source file has a colocated `<name>.test.ts`; no
      `src/server/**` test is named after anything but a source file beside it.
- [x] 1.3 Move: handler tests beside their handler (a test each for the navigation, assist, documents,
      lifecycle, formatting, diagnostics and structure handlers, named after them), the finding-named tests merged
      in; server-file tests beside `server.ts`, `state.ts`, `diagnostics.ts`, `vendor.ts`, `bin.ts`; the black-box suites
      to `test/lsp/`. Every test file gets a header saying what it covers. No assertion removed or weakened.
- [x] 1.4 Test count equal or higher than 1.1's; `bun typecheck`, lint, full suite `VOLT_REQUIRE_FULL=1` green;
      `test/README.md` names `test/lsp/`. Archive.

## 2. Widened: services/, workspace/, test/ root

- [x] 2.1 `services/` (not network): the 9 topic/finding-named tests merged into or renamed after the source file they
      exercise; the two loose root tests beside what they test.
- [x] 2.2 `workspace/`: `dead-code-cache.test` and `incremental-index.test` into `workspace-store.test.ts` (or split by the
      source file each exercises).
- [x] 2.3 `test/`: `network-text-on.ts` into the support it serves; `test/server/` (harness, sources) and the black-box
      suites under ONE root `test/lsp/`.
- [x] 2.4 The gate's rule over all of `src/`: a colocated test is named after a source file beside it, except the listed
      topic suites (transpile/pipeline ×7, fuzz, totality, classification — each with its reason) and the 4 network-text
      tests (LD/FBD change). Test count equal or higher; full suite green.
