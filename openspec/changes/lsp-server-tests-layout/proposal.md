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

## Widened (2026-10-12, owner: "this is the last messy part?")

Measured over all of `src/`: 26 of the other 270 tests are named after no source file beside them.
- **Same problem, in scope:** `services/` (not network) 9 — `services.test.ts` and `accessor-scope.test.ts` loose at the
  `services/` root; `assist/assist.test`, `gvl-members`, `interface-members`, `structure/structure.test`,
  `semantic-tokens-primitives`, `implementation-keyword-structure`, `navigation/references-type-positions` named after
  topics; `workspace/` 2 — `dead-code-cache.test` and `incremental-index.test` test `workspace-store.ts` (moved there by
  lsp-same-standard) under their old names; `test/` root — a loose `network-text-on.ts`, and `test/server/` (the harness)
  beside the new `test/lsp/` (one root for the server as a client sees it).
- **Deliberate topic suites, kept and allowlisted in the gate with their reason:** `transpile/pipeline/*.test.ts` (7, the
  end-to-end pipeline per subject), `syntax/parse/fuzz.test.ts`, `lower/entry/totality.test.ts`,
  `lower/diagnostics/classification.test.ts`.
- **Out of scope (network text, until the LD/FBD change):** the 4 network-text tests.

So the rule holds for the whole package: a colocated test is named after a source file beside it, unless it is a listed
topic suite.
