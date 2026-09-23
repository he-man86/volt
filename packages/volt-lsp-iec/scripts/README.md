# `scripts/` — dev tooling, NOT tests

**Nothing here is a test.** `bun test` never runs this directory (it targets `src` + `test/`). These are tools you
run **by hand** (or in CI, for the offline ones) to *produce or inspect* the ground-truth data the tests check
against. The tests themselves live in `src/**/*.test.ts` and `test/` — see [`../TESTING.md`](../TESTING.md).

## Libraries (imported, not run)

| File | Role |
|---|---|
| `bridge.ts` | named-pipe client — `call(op, body)` speaks the Volt wire to a live bridge |
| `bridge-fixture.ts` | `openFixture()` → `{ set, del, reset }` — push items + reset the fixture project between repros |

## Live tools (a bridge must be up)

Bring one up first: `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys`. With no `VOLT_PIPE`
it serves `volt.bridge.codesys.<pid>` — pass `VOLT_PIPE=volt.bridge.codesys.<pid>` to the tool.

| File | Produces / does |
|---|---|
| `record-language.ts` | conformance recordings → `test/conformance/recordings/` |
| `record-corpus-build.ts` | a corpus project's real IDE build snapshot → `corpus.test.ts` oracle |
| `refresh-corpus.ts` | refreshes a `test-corpus/<name>/` project via `volt pull` |
| `verify-catalog.ts` | verifies implemented C-code wording vs the IDE → `error-catalog.json` verified flags |
| `record-gaps.ts` | probes unverified compiler-warning gap codes for their real trigger/wording |
| `audit-check.ts` | ad-hoc "is this check right?" — LSP vs `/build`; touches no test data |
| `probe-is-it-compiled.ts` | is an object actually COMPILED? plants an error, builds, restores — point at a COPY |
| `conversion-matrix.ts` | calibrates `classifyConversion` against the live compiler |

## Offline tools (pure, run under `bun`)

| File | Does |
|---|---|
| `catalog-status.ts` | renders the C-code catalog status matrix (LSP / CS / TC) |
| `corpus-fp.ts` | the zero-FP corpus oracle in debuggable, grouped-by-code form |
| `probe-projectsettings-effect.ts` | proves a project's `.projectsettings` actually SUPPRESSES diagnostics (per-code delta, settings on vs off) |
| `parser-completeness.ts` | parser-recovery evidence over the corpus |
| `lower-completeness.ts` | transpiler coverage over the corpus — what each construct would unblock, ranked |
| `corpus-census.ts` | what the CORPUS contains that the FIXTURES do not — the work list for new fixtures |
| `agreement-residue.ts` | why each fixture does NOT agree with the IDE — the work list for closing the gap |
| `probe-extends-ambiguity.ts` | which `EXTENDS` names have more than one candidate, and whether the candidates DIFFER — the measurement behind the binder's library-visibility rule |
| `probe-order-dependence.ts` | lowers a corpus project twice, sorted and reversed, and diffs the routines — proves the symbol table no longer depends on the order files are bound |
| `probe-lowering-refusals.ts` | every POU with code that does NOT lower, and the codes it was refused for — diff before/after a resolver change to attribute a moved figure |
| `probe-dep-depth.ts` | how deep in the DEPENDENCIES graph an ambiguous reference has to reach (measured: never past depth 1, which is why visibility is direct-only) |
| `probe-ambiguous-uses.ts` | project declarations naming a type two libraries export, and whether those candidates DIFFER — the measurement behind the corpus ambiguity gate |
| `check-layering.ts` | the `bun run lint` gate — fails on an illegal upward layer import |
