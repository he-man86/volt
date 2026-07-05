## 1. Baseline

- [ ] 1.1 Measure on the largest corpus (pro2193, 803 files): `initialized` seed time, `getProjectScope` build time, and representative definition/references/hover/completion latency. Record the numbers.

## 2. Per-document caching

- [ ] 2.1 Replace the all-or-nothing `Workspace.invalidate()` (`workspace.ts`) with per-document symbol caching — an edit re-parses only the changed file.
- [ ] 2.2 `getProjectScope` recomposes from cached per-file symbols rather than re-parsing the workspace.

## 3. Startup

- [ ] 3.1 Batch the `initialized` seed (`dispatch.ts`) so a large project doesn't block startup.

## 4. Budget

- [ ] 4.1 Add a performance-budget assertion to the test suite (index-build + per-query thresholds from §1); optionally flag-gate the heavy perf test if the full tree is large.

## 5. Land it

- [ ] 5.1 `cd packages/volt-lsp-iec && bun test` green and `bun typecheck` clean; corpus ratchet unaffected.
- [ ] 5.2 `openspec validate st-perf`; sync the `language-server` delta + archive.
