# `scripts/` — dev tooling, NOT the test suite

These are tools you run **by hand** (or in CI, for the offline ones) to *produce or inspect* the ground-truth data the
tests check against. The tests live in `src/**/*.test.ts` and `test/` — see [`../TESTING.md`](../TESTING.md). The one
exception is the two unit tests of the libraries below (`bridge.test.ts`, `held-as.test.ts`): a bare `bun test`
discovers them here and runs them with the rest. `bun run typecheck` covers every `.ts` file in this directory.

Every file is listed once, grouped by purpose. **Live** = a bridge (or a CODESYS install) must be up; **offline** =
pure, runs under `bun`. The paths stay flat on purpose: open openspec changes, tests and source comments name
`scripts/<file>`, and a move would break them (re-checked by openspec `lsp-package-structure` 2.3).

To bring a bridge up: `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat [-Instance <name>] -Wait`.
**A live tool drives only that instance's fixture IDE** (`bridge.ts` → volt-cli's `test/e2e/lib/fixture-ide.ts`, the one
implementation of the rule for every script in the repo): `VOLT_E2E_INSTANCE=<name>` names the instance (unset = the
default one), or `VOLT_PIPE=volt.bridge.<vendor>.<pid>` names one exact pipe that an instance provably owns. A pipe no
instance owns — an engineer's own IDE, another session's — is refused, naming it and its project; there is no prefix
discovery and no default pipe name. An instance serving two projects (TwinCAT's `-Fixture both`) is refused too until
`VOLT_PIPE` picks one or `-Fixture 13` serves one. (2026-10-03: prefix discovery once made the e2e suite write into an
engineer's 881-item project.) `record-exec.ts` is the exception that needs none of this: it talks to no pipe at all —
its half inside CODESYS is the runscript of the headless CODESYS it spawned itself (`spawnSync`, so its hang guard kills
only that child), opening a copy of the fixture.

**Probes are single use.** A one-question measurement goes once its answer is cited; the citation stays and points at
history (`… (deleted; git show <commit>:packages/volt-lsp-iec/scripts/<file>)`). On 2026-10-03 that removed
`probe-dep-depth.ts`, `probe-is-it-compiled.ts`, `probe-order-dependence.ts`, `probe-position-length.ts` and
`measure-sfc-step-names.ts` (last commit holding them: `b2496efb4b`). The two `probe-*` files left are named by open
openspec tasks — see the Measure table.

## Libraries (imported by the tools, not run)

| File | Role |
|---|---|
| `bridge.ts` | named-pipe client — `call(op, body)` speaks the Volt wire to a live bridge; `pipeName` resolves the ONE pipe through the fixture-instance rule (never a prefix, never a default name); `requireNetworkText` refuses a bridge whose LD/FBD network text is off; tested in `bridge.test.ts` |
| `bridge-fixture.ts` | `openFixture()` → `{ set, del, reset }` — push items + reset the fixture project between repros |
| `held-as.ts` | where the IDE holds an item the recorder pushed (`x.pou` as `X.pou`, a GVL as `unreadable`) — `record-language.ts`'s cleanup lookup, tested in `held-as.test.ts` |
| `recording-target.ts` | which target a recording was made on (`plat_xint_into_string`'s `__XINT` width) — `check-recording.ts` and `record-language.ts`'s `RECORD_ONLY` merge refuse anything but the 64-bit oracle, or, with `VOLT_RECORDING_TARGET=32`, anything but a 32-bit target (into `<vendor>-32.build.json`, rule TY6) |

## Record — write committed ground truth (live)

| File | package.json | Produces |
|---|---|---|
| `record-language.ts` | `record:language` | conformance build recordings → `test/conformance/recordings/<vendor>.build.json` (`VOLT_RECORDING_TARGET=32` + `RECORD_ONLY`: a 32-bit target's, `twincat-32.build.json`, replayed by `target-32.test.ts`) |
| `record-exec.ts` | `record:exec` | the execution recording `test/conformance/recordings/codesys.run.json` — launches a headless CODESYS with `record-exec.py` as its runscript — and talks only to THAT process: no pipe, the recorder half runs inside the CODESYS it spawned (verified 2026-10-03), so the fixture-instance rule has nothing to resolve |
| `record-exec.py` | — | the IronPython runscript `record-exec.ts` drives: per case, load the fixture's units into a simulated copy, build, run, read every path |
| `record-corpus-build.ts` | — | a corpus project's real IDE build snapshot → the `corpus.test.ts` oracle |
| `refresh-corpus.ts` | `refresh:corpus <name>` | refreshes a `test-corpus/<name>/` project via `volt pull` |
| `verify-catalog.ts` | — | verifies implemented C-code wording vs the IDE → `docs/codesys-reference/catalog-verification.json` / the catalog's verified flags |
| `record-gaps.ts` | — | probes unverified compiler-warning gap codes for their real trigger and wording |

## Check — gates and adoption checks

| File | Live? | Does |
|---|---|---|
| `check-layering.ts` | offline | the `bun run lint` gate — fails on an illegal upward layer import, and on a front-end import rule (F1–F6: the front-end imports no consumer, consumers import it through its indexes) or an analysis rule (A1–A6: analysis reaches the reference catalog through its index, outsiders only `analysis/index.js`, a check imports no other check nor the registry/pipeline, only the registry and pipeline import checks, no analysis test imports a rank above analysis, every check has its colocated test) outside its known-violation lists (`KNOWN_ANALYSIS_VIOLATIONS` is empty); `test/frontend/layering.test.ts` runs it inside `bun test` |
| `check-recording.ts` | offline | is a fresh `<vendor>.build.new.json` fit to adopt (dropped rows, cross-fixture contamination, the target's pointer width)? `--diff` compares the committed CODESYS and TwinCAT recordings |
| `suite-snapshot.ts` | offline | gate T: every test of the suites a move touches as `status  describe › title` — the gate for moving tests between files (`<out.txt>`, `--compare <before.txt>`; `--dirs a,b`, default the conformance suite, `src/transpile`, `src/frontend/{types,symbols,syntax}` and `test/libraries`) |
| `transpile-snapshot.ts` | offline | `snapshot:transpile` — snapshot S (transpile-restructure design.md §8): per fixture the canonical IR, the emitted Rust + source map, both backends' values on the declared and the edge inputs, and the edge verdict (`test/conformance/support/snapshot.ts`); `write [--baseline]`, `check [--layers ir,rust,outputs,edge]` against `test/conformance/.snapshot/baseline/` (gitignored), printing the first difference per fixture; Rust built through the rustc cache |
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

## Measure — offline evidence over the corpus and the fixtures

| File | Measures |
|---|---|
| `corpus-fp.ts` | the zero-FP corpus oracle in debuggable, grouped-by-code form (no test timeout), over the server's own `projectDocuments` |
| `corpus-census.ts` | what the CORPUS contains that the FIXTURES do not — the work list for new fixtures |
| `agreement-residue.ts` | why each fixture does NOT agree with the IDE — the work list for closing the gap |
| `parser-completeness.ts` | parser-recovery evidence over the corpus |
| `lower-completeness.ts` | transpiler coverage over the corpus — what each construct would unblock, ranked |
| `probe-lowering-refusals.ts` | every POU with code that does NOT lower, and the codes it was refused for — diff before/after a resolver change to attribute a moved figure (run by openspec `transpile-restructure` 4.1; named by `test/corpus/corpus.test.ts`) |
| `probe-projectsettings-effect.ts` | proves a project's `.projectsettings` actually SUPPRESSES diagnostics (per-code delta, settings on vs off; rewired by openspec `analysis-conformance` 1.3, re-run after it) |
