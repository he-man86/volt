# `scripts/` — dev tooling, NOT tests

**Nothing here is a test.** `bun test` never runs this directory (it targets `src` + `test/`). These are tools you
run **by hand** (or in CI, for the offline ones) to *produce or inspect* the ground-truth data the tests check
against. The tests themselves live in `src/**/*.test.ts` and `test/` — see [`../TESTING.md`](../TESTING.md).

## Libraries (imported, not run)

| File | Role |
|---|---|
| `bridge.ts` | named-pipe client — `call(op, body)` speaks the Volt wire to a live bridge |
| `bridge-fixture.ts` | `openFixture()` → `{ set, del, reset }` — push items + reset the headless project between repros |

## Live tools (a bridge must be up)

Bring one up first: `pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up` (CODESYS, headless). With no `VOLT_PIPE`
it serves `volt.bridge.codesys.<pid>` — pass `VOLT_PIPE=volt.bridge.codesys.<pid>` to the tool.

| File | Produces / does |
|---|---|
| `record-language.ts` | conformance recordings → `test/conformance/recordings/` |
| `record-corpus-build.ts` | a corpus project's real IDE build snapshot → `build-conformance.test.ts` oracle |
| `refresh-corpus.ts` | refreshes a `test-corpus/<name>/` project via `volt pull` |
| `verify-catalog.ts` | verifies implemented C-code wording vs the IDE → `error-catalog.json` verified flags |
| `record-gaps.ts` | probes unverified compiler-warning gap codes for their real trigger/wording |
| `audit-check.ts` | ad-hoc "is this check right?" — LSP vs `/build`; touches no test data |
| `conversion-matrix.ts` | calibrates `classifyConversion` against the live compiler |

## Offline tools (pure, run under `bun`)

| File | Does |
|---|---|
| `catalog-status.ts` | renders the C-code catalog status matrix (LSP / CS / TC) |
| `corpus-fp.ts` | the zero-FP corpus oracle in debuggable, grouped-by-code form |
| `parser-completeness.ts` | parser-recovery evidence over the corpus |
| `check-layering.ts` | the `bun run lint` gate — fails on an illegal upward layer import |
