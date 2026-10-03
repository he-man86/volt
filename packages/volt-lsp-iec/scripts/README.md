# `scripts/` — dev tooling, NOT the test suite

These are tools you run **by hand** (or in CI, for the offline ones) to *produce or inspect* the ground-truth data the
tests check against. The tests live in `src/**/*.test.ts` and `test/` — see [`../TESTING.md`](../TESTING.md). The one
exception is the two unit tests of the libraries below (`bridge.test.ts`, `held-as.test.ts`): a bare `bun test`
discovers them here and runs them with the rest. `bun run typecheck` covers every `.ts` file in this directory.

Every file is listed once, grouped by purpose. **Live** = a bridge (or a CODESYS install) must be up; **offline** =
pure, runs under `bun`. The paths stay flat on purpose: open openspec changes, tests and source comments name
`scripts/<file>`, and a move would break them (re-checked by openspec `lsp-package-structure` 2.3).

To bring a bridge up: `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat`. It serves
`volt.bridge.<vendor>.<pid>` — pass `VOLT_PIPE=volt.bridge.<vendor>.<pid>` to the tool.

## Libraries (imported by the tools, not run)

| File | Role |
|---|---|
| `bridge.ts` | named-pipe client — `call(op, body)` speaks the Volt wire to a live bridge; `requireNetworkText` / `servedPipe` refuse a bridge whose LD/FBD network text is off; tested in `bridge.test.ts` |
| `bridge-fixture.ts` | `openFixture()` → `{ set, del, reset }` — push items + reset the fixture project between repros |
| `held-as.ts` | where the IDE holds an item the recorder pushed (`x.pou` as `X.pou`, a GVL as `unreadable`) — `record-language.ts`'s cleanup lookup, tested in `held-as.test.ts` |
| `recording-target.ts` | which target a recording was made on (`plat_xint_into_string`'s `__XINT` width) — `check-recording.ts` and `record-language.ts`'s `RECORD_ONLY` merge refuse anything but the 64-bit oracle, or, with `VOLT_RECORDING_TARGET=32`, anything but a 32-bit target (into `<vendor>-32.build.json`, rule TY6) |

## Record — write committed ground truth (live)

| File | package.json | Produces |
|---|---|---|
| `record-language.ts` | `record:language` | conformance build recordings → `test/conformance/recordings/<vendor>.build.json` (`VOLT_RECORDING_TARGET=32` + `RECORD_ONLY`: a 32-bit target's, `twincat-32.build.json`, replayed by `target-32.test.ts`) |
| `record-exec.ts` | `record:exec` | the execution recording `test/conformance/recordings/codesys.run.json` — launches a headless CODESYS with `record-exec.py` as its runscript |
| `record-exec.py` | — | the IronPython runscript `record-exec.ts` drives: per case, load the fixture's units into a simulated copy, build, run, read every path |
| `record-corpus-build.ts` | — | a corpus project's real IDE build snapshot → the `corpus.test.ts` oracle |
| `refresh-corpus.ts` | `refresh:corpus <name>` | refreshes a `test-corpus/<name>/` project via `volt pull` |
| `verify-catalog.ts` | — | verifies implemented C-code wording vs the IDE → `docs/codesys-reference/catalog-verification.json` / the catalog's verified flags |
| `record-gaps.ts` | — | probes unverified compiler-warning gap codes for their real trigger and wording |

## Check — gates and adoption checks

| File | Live? | Does |
|---|---|---|
| `check-layering.ts` | offline | the `bun run lint` gate — fails on an illegal upward layer import, and on a front-end import rule (F1–F6: the front-end imports no consumer, consumers import it through its indexes) outside its known-violation list; `test/frontend/layering.test.ts` runs it inside `bun test` |
| `check-recording.ts` | offline | is a fresh `<vendor>.build.new.json` fit to adopt (dropped rows, cross-fixture contamination, the target's pointer width)? `--diff` compares the committed CODESYS and TwinCAT recordings |
| `suite-snapshot.ts` | offline | every conformance/execution test as `status  describe › title` — the gate for moving tests between files (`--compare <before.txt>`) |
| `frontend-snapshot.ts` | offline | `snapshot:frontend` — snapshot F: every front-end output (AST, errors, tokens, statement trees, resolution/type/fold dumps, corpus diagnostics) and every fixture's lowering, Rust and interpreter values, hashed per source; `check [--base <rev>]` compares the working tree with a commit built in a temporary worktree (cached in `test/frontend/.snapshot/`); `show <id> <aspect>` prints one in full |
| `dead-exports.ts` | offline | which exported names in `src/` nobody imports (NOBODY) or only tests/scripts import — a deletion list to read, not to apply blind |

## Generate — committed files derived from data (offline)

| File | package.json | Writes |
|---|---|---|
| `rate-fixtures.ts` | `rate:fixtures` | `test/conformance/fixtures/map.generated.ts` — one row per fixture (evidence, tier, Rust oracle, lints, edge, size, notes); `--check` reports drift |
| `coverage-doc.ts` | — | `docs/codesys-reference/compiler-warnings-coverage.md` from the error catalog |
| `catalog-status.ts` | — | the C-code catalog status matrix (LSP / CS / TC), printed |

## Audit — ad-hoc "is this right?" against the live compiler (live, touch no test data)

| File | package.json | Asks |
|---|---|---|
| `audit-check.ts` | `audit:check <battery>` | LSP vs `/build` for a battery of cases |
| `conversion-matrix.ts` | — | calibrates `classifyConversion` against the live compiler; `--explicit` (offline) lists the `X_TO_Y` pairs no recorded fixture calls (rule CV7) |
| `probe-is-it-compiled.ts` | — | is an object actually COMPILED? plants an error, builds, restores — point at a COPY (cited by `test/conformance/fixtures/graphical/network-unresolved.ts`) |
| `probe-position-length.ts` | — | what `__POSITION` expands to, measured through the size the compiler reports (cited by `test/conformance/support/divergences.ts`) |

## Measure — offline evidence over the corpus and the fixtures

| File | Measures |
|---|---|
| `corpus-fp.ts` | the zero-FP corpus oracle in debuggable, grouped-by-code form (no test timeout) |
| `corpus-census.ts` | what the CORPUS contains that the FIXTURES do not — the work list for new fixtures |
| `agreement-residue.ts` | why each fixture does NOT agree with the IDE — the work list for closing the gap |
| `parser-completeness.ts` | parser-recovery evidence over the corpus |
| `lower-completeness.ts` | transpiler coverage over the corpus — what each construct would unblock, ranked |
| `probe-lowering-refusals.ts` | every POU with code that does NOT lower, and the codes it was refused for — diff before/after a resolver change to attribute a moved figure (named by openspec `transpile-restructure` and `test/corpus/corpus.test.ts`) |
| `probe-order-dependence.ts` | lowers a corpus project twice, sorted and reversed, and diffs the routines — proves the symbol table does not depend on the order files are bound |
| `probe-dep-depth.ts` | how deep in the DEPENDENCIES graph an ambiguous reference has to reach (measured: never past depth 1, which is why visibility is direct-only — cited by `src/frontend/symbols/library-namespaces.ts`) |
| `probe-projectsettings-effect.ts` | proves a project's `.projectsettings` actually SUPPRESSES diagnostics (per-code delta, settings on vs off; named by openspec `analysis-conformance`) |
| `measure-sfc-step-names.ts` | openspec `lsp-sfc-step-names` 3.1 — the SFC step-name field case, its typo shapes and a pull without the `IMPLEMENTATION SFC` line, plus every SFC POU in the corpora diagnosed alone — the numbers behind DIALECT D40's bet and its price |
