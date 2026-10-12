## Why

`lsp-same-standard` (archived 2026-10-12) made `packages/volt-lsp-iec/src/server/` source clean — `server.ts`, `state.ts`,
`diagnostics.ts`, `vendor.ts`, `bin.ts`, `config.ts`, `index.ts` and `handlers/` (one file per request group, 493 lines) —
but left its TESTS flat beside them. The owner (2026-10-12): "it looks messy". Measured: 17 test files next to 6 source
files, in no order:
- handler tests not beside their handler: `server-navigation.test.ts` covers `handlers/navigation` + `handlers/assist`,
  `server-documents.test.ts` covers `handlers/documents` + `handlers/lifecycle`; `on-type-formatting`, `rename`,
  `ranges`, `watched-files` are named after review findings, not after what they test;
- diagnostics spread over five files (`diagnostics`, `server-diagnostics`, `diagnostic-identity`,
  `implementation-keyword-diagnostics`, `capability-matrix`);
- black-box suites that drive the whole server over its protocol and are no unit test of one file: `bench` (latency),
  `navigation-golden`, `capability-matrix`, `diagnostic-identity`, `network-text-switch`,
  `implementation-keyword-diagnostics`;
- `rename.test.ts` and `server.test.ts` carry no header saying what they cover.

## What Changes

- Each `server/*.ts` and `handlers/*.ts` source file has its own colocated test, named after it; finding-named tests are
  merged into the test of the handler they exercise (their finding citations kept in the test names/comments).
- The black-box protocol suites move to `test/lsp/` (one root for "the server as a client sees it"), with a README line.
- Every test file states what it covers in its header.
- The structure gate (`test/package/structure.test.ts`) gains: every `server/` and `handlers/` source file has its own
  test; no test file under `src/server/` is named after anything but a source file beside it.

Output-neutral: no test is deleted or weakened — the same assertions, moved; the test count is unchanged or higher.

## Impact

`packages/volt-lsp-iec` only (`src/server/**`, `test/lsp/`, `test/package/structure.test.ts`, `test/README.md`). No product
code changes.
