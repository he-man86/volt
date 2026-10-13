# Testing — what tests what

**Quick answer to "where do the tests live?"** Two places, and `scripts/` is **not** one of them:

- **`src/**/*.test.ts`** — unit tests, colocated next to the code they test.
- **`test/`** — the cross-cutting suites: four concerns, each file named for its question. See [`test/README.md`](test/README.md).
- **`scripts/`** — **tooling, NOT tests.** Dev tools that talk to a live IDE to *produce* the ground-truth data
  the tests check against. `bun test` never runs them (it targets `src/` and `test/`). See
  [`scripts/README.md`](scripts/README.md).

Everything under `bun test` is **offline and deterministic** — no live IDE needed.

## By use case — "I want to test/understand X, where do I look?"

| I want to… | Look in | Layer |
|---|---|---|
| a **C-code** (a `Cnnnn` diagnostic) — is it emitted, with the right wording? | `test/catalog/catalog.test.ts` (master net, one test per code) **+** the check's own `src/analysis/checks/**/*.test.ts` | Unit |
| check a C-code matches the **real CODESYS/TwinCAT** byte-for-byte | run `scripts/verify-catalog.ts` (live) → stamps `docs/codesys-reference/error-catalog.json`; view status with `scripts/catalog-status.ts` | Tooling |
| a **language feature** — parse, resolve, hover, completion, signature, format, semantic tokens | colocated `src/frontend/{syntax,symbols,types}/`, `src/services/**/*.test.ts` | Unit |
| a **graphical (network-text)** body | `src/services/network/*.test.ts` · `src/frontend/types/network/*.test.ts` · `src/analysis/checks/network/*.test.ts` | Unit |
| prove a feature/diagnostic **agrees with the real compiler** | `test/conformance/lsp-replay.test.ts` and `transpile-replay.test.ts` / `-lowered` / `-refusals` (replay recorded IDE output — no live IDE) | Conformance |
| **no invented diagnostics on real projects** | `test/corpus/corpus-diagnostics.test.ts` | Corpus |

## The three test layers

| Layer | Where | What it proves | Oracle (source of truth) |
|---|---|---|---|
| **Unit** | `src/**/*.test.ts` | each module is correct in isolation (parser, binder, types, one check, one service) | the code's own spec — hand-written expectations |
| **Conformance** | `test/conformance/` | our diagnostics match the **real compiler**, byte-for-byte | `recordings/` — captured from live CODESYS/TwinCAT |
| **Corpus** | `test/corpus/` | **zero invented diagnostics** on real projects — every error and warning is one the IDE's own build emitted | `test-corpus/<project>/expected-build.codesys.json` — recorded live builds |

They layer, they don't overlap:
- **Unit** = white-box. "Does this function do what I wrote?"
- **Conformance** = black-box vs the compiler. "Do we *agree with CODESYS/TwinCAT*?" It runs our LSP on each
  `fixtures/` case and compares to the recorded IDE output. The live IDE is **not** hit here — the replays
  (`lsp-replay.test.ts`, `transpile-replay*.test.ts`) read the JSON in `recordings/`.
- **Corpus** = black-box vs reality. "Does the LSP survive real code without crying wolf?" Every error and
  warning we emit on a corpus project must be one the IDE's own build also emitted. (It is NOT "a clean project
  produces no diagnostics" — the projects are not clean.)

### `test/`, in detail — four concerns

**[`test/README.md`](test/README.md) is the map** and is not repeated here. In short: the file name is the
QUESTION, not the mechanism; a concern that outgrew one file is split by subject over one walk and one selection.

```
test/
  conformance/
    fixtures/                input ST code + metadata (the cases)          <- authored by hand
    support/                 plc-prg.ts (the one PLC_PRG text) . standard-library.ts . evidence.ts
    recordings/
      codesys.build.json     what CODESYS's build said     <- scripts/record-language.ts (live bridge)
      twincat.build.json     what TwinCAT's build said     <- scripts/record-language.ts (TwinCAT worker)
      codesys.run.json       every variable after N scans  <- scripts/record-exec.ts (headless simulator)
    transpile-replay.test.ts THE FIXTURE CONTRACT's rows - one per evidence rating: the confirmed runs, the
                             interpreter and the emitted Rust vs the run
    transpile-replay-lowered.test.ts   the rest of the lowered fixtures: the emitted Rust builds (or says why
                             not), the stored oracle matches the compiler, the diverges rows as expected failures
                             (it and transpile-replay.test.ts run one set of steps, support/transpile/replay-steps.ts)
    transpile-replay-refusals.test.ts  every vendor refusal refused, every lowering refusal a registered code,
                             every gap named
    map.test.ts              the map's measured columns, the rating itself recomputed, the evidence ratchet
    lsp-replay.test.ts       the LSP's diagnostics vs each vendor's build (no false positive, the agreement
                             ratchet); all but -refusals share support/fixture-suite.ts (selection, lowering, ratings)
    backends.test.ts         interp vs emitted Rust, where no recording reaches
    suite.test.ts            is enough being ASKED - the census, our grammar, the vendor's index
    properties.test.ts       the memory model as properties
    source-map.test.ts       every mapping names a Rust line that exists
  libraries/
    repo.test.ts             every library and version the repo writes, held to the interface a corpus project
                             that resolves that version materialized
    standard.test.ts         Standard: the version lookup, and the FBs (timers over a harness clock) in both backends
    util.test.ts             Util's BLINK — one repo library (Standard's TP) inside another — in both backends
    stringutils.test.ts      the STR* functions over string cursors, their contract cases, in both backends
  corpus/
    corpus.test.ts           THE CORPUS - three questions: the LSP can read it (the one walk, support/walk.ts),
    corpus-diagnostics.test.ts  it invents nothing (vs each project's recorded IDE build; the one LSP diagnostic
                                pass, support/diagnostics.ts),
    corpus-lowering.test.ts     and lowering is total over it (the same walk)
    corpus-provenance.test.ts   every corpus file is the current bridge's answer, or listed with its reason
                                (support/stale.ts: manifests in the retired spelling, objects a corpus lacks)
  catalog/
    catalog.test.ts          one test per documented Cnnnn
  frontend/                  the front-end MEASURED against the recordings (openspec frontend-conformance phase 0):
                             parse census, printer fixed point, resolution / type / fold dumps, each with a pinned
                             baseline of findings in baselines/ and a ceiling per disagreement measure in
                             baselines/ceilings.json (baseline/baseline.test.ts: may only fall, against git history);
                             rules.ts + rules.test.ts, the rule catalogue as data (its rows in rules-a.ts …
                             rules-p.ts, assembled in order); dumps.ts with dumps-bound.ts / dumps-printer.ts;
                             bound-census.ts walks everything bound once (its question groups in bound-census-*.ts)
  analysis/                  the analysis MEASURED against the recordings (openspec analysis-conformance phase 0):
                             diagnostic-census.test.ts (built by census.ts: census-fixtures.ts, census-owners.ts) — every registry check and message builder over every fixture
                             (both vendors, the replay's composition) and the six corpora: TP / SEV / FP / GAP, pinned in
                             baselines/ with a ceiling per open FP, GAP, unowned GAP and never-fired builder
                             (VOLT_CENSUS_REPORT=1 prints the per-check table). Counts move only with
                             VOLT_WRITE_BASELINE=1 in the commit that moves them; a ceiling never rises — a rise
                             the ratchet accepts is a NAMED exception (test/baseline/baseline.ts CEILING_EXCEPTIONS: the
                             fixture, the task that owns its fix, why) that fails once the fixture stops producing it.
                             Every analysis-conformance 3.x step wrote its group's FP/GAP before → after from it.
  baseline/                  the baseline discipline frontend/ and analysis/ share: pinned findings, ceilings that only
                             fall, CEILING_EXCEPTIONS (its entries in baseline-a.ts / -b.ts / -c.ts; baseline.test.ts
                             holds both ceilings files to their history)
  lsp/                       the server as a client sees it: the black-box suites that drive the whole server over its
                             protocol (capability-matrix, diagnostic-identity, navigation-golden, network-text-switch,
                             implementation-keyword-diagnostics, the scheduling suites diagnostics-pull, disk-sync and
                             server-robustness, the opt-in latency bench); harness.ts — the LSP client they and
                             src/server's colocated tests drive, sources.ts — the documents and steps they share,
                             probes.ts — the delegating parse, compute and read mocks the scheduling suites count work with
  package/                   the package's own shape: build.test.ts (the published build compiles), layering.test.ts
                             (every import obeys scripts/check-layering.ts), structure.test.ts (no loose src/ file but
                             the barrel, no src/ file only tests import, every src/ and test/ folder in docs/architecture.md "The tree", every script
                             in scripts/README.md)
  support/                   test-uri.ts — the URI a colocated test names a source by; call-diagnostics.ts — the
                             call-argument tests' harness; network-text-on.ts — the preload bunfig.toml names (test
                             support, no suite); culture.ts — the VOLT_TEST_CULTURE locale switch, the second
                             preload, with culture.test.ts, which fails a locale run that did not switch
```

A **fixture** is only input. A **recording** is the ground truth, and each file has ONE recorder. The two
**ratchets** in `lsp-replay.test.ts` and `map.test.ts` only ever move one way: exact per-vendor message agreement, and a ceiling per
evidence rating. A fixture the IDE and LSP disagree on for a documented reason is in `KNOWN_DIVERGENCES`. A case
CODESYS refuses is outside the transpiler's input contract (`src/transpile/index.ts`), so only the refusal is
checked. Moving tests between files is gated by `scripts/suite-snapshot.ts` (every title and result, before vs
after).

**The corpus is NOT clean**, and no gate may assume it is. Real projects carry real build errors, warnings and
typo'd attributes; the oracle is each project's own recorded IDE build (`scripts/record-corpus-build.ts`), not an
assumption that a clean project produces no diagnostics. A gate written on that assumption flagged precompiled
library patterns and demoted a real warning class for 1300+ hits.
### C-codes, in detail (the data pipeline)

The CODESYS `Cnnnn` catalog is data in `docs/codesys-reference/`, turned into tests + reports:

```
error-catalog.json  ── master checklist (status/ourCode/repro/verified per code)
   │
   ├─▶ test/catalog/catalog.test.ts   one test per code: implemented→burn-in, checkable→todo, ide-only→skip
   ├─▶ scripts/verify-catalog.ts  (live)     build each repro on CODESYS/TC, confirm LSP wording ⊆ IDE → verified flags
   ├─▶ scripts/catalog-status.ts  (offline)  render the status matrix (LSP / CS / TC)
   └─▶ compiler-warnings-coverage.md         the dialog's 66 configurable codes + Volt's coverage/gaps
```

## The tooling (in `scripts/`)

Recorders, gates, generators, audits and measurements — every script with its purpose, whether it needs a live bridge,
and its `package.json` alias is listed in [`scripts/README.md`](scripts/README.md) (one list; this file keeps none).
Bring a bridge up first (the data wire is a **named pipe**, not an HTTP port):
`pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat` serves `volt.bridge.<vendor>.<pid>` (CODESYS loads
the bridge in-proc in a GUI IDE; for TwinCAT the script spawns the `VoltBridgeTwincat --xae-pid` worker) — pass
`VOLT_PIPE=volt.bridge.<vendor>.<pid>` to the tool.

## Running

```bash
cd packages/volt-lsp-iec
bun test                       # unit + conformance (offline)
bun test test/corpus           # the corpus layer (heavier)
bun test src/analysis/checks   # just the check unit tests
bun test test/conformance      # just conformance replay
bun test -t "C0357"            # one code across the suite
bun run typecheck              # everything: src + test + scripts (tsconfig.json). Build = tsconfig.build.json
bun run lint                   # the layering check
```

### The inner loop — runs that cost what they check

While a step is being worked on, run only what it touches. **A gate, a close and CI never use these** — they run
the whole suite (and a close runs it cold, `VOLT_RUSTC_CACHE=0`).

```bash
# the fixture contract for the NAMED fixtures only — registered, LSP-run and Rust-built alone (~3 s for three)
VOLT_FIXTURES=bit_or_bool,decl_subrange_unsigned bun test test/conformance/transpile-replay.test.ts test/conformance/transpile-replay-lowered.test.ts test/conformance/transpile-replay-refusals.test.ts test/conformance/map.test.ts test/conformance/lsp-replay.test.ts
# one front-end baseline file (test/frontend): census, resolution, type, fold, fixed point, rules
bun test test/frontend/parse-census.test.ts
bun test test/frontend/type-dump.test.ts test/frontend/fold-dump.test.ts test/frontend/resolution-dump.test.ts
# the diagnostic census (test/analysis) — every check over every fixture and corpus, ~2.5 min
bun test test/analysis
```

- **`VOLT_FIXTURES=<name,name,…>`** (`test/conformance/support/selection.ts`) — exact names; an unknown one throws, so a
  typo is never a green run of nothing. Each named fixture goes through the same code the full run gives it, against
  the same project (every other fixture's declarations stay bound). What only the whole suite can answer — the
  evidence ceilings, the agreement floors, the map's NOTES section and dead notes — is skipped, and the run prints
  `PARTIAL RUN`. `CI` or `VOLT_REQUIRE_FULL=1` refuse it (a gate and a close set `VOLT_REQUIRE_FULL=1`).
  `test/conformance/partial-run.test.ts` holds that a partial run answers what the full run does for what it names:
  every row it EXECUTES either names a selected fixture or is listed there as scoped to the selection — a new
  project-wide row written as plain `test()` instead of `whole()` fails it by title. `-t "<names>"` is no substitute: it filters which tests
  run *after* every fixture was registered and the whole Rust before-all phase ran (~73 s for three fixtures).
- **One baseline file** runs alone. `type-dump`, `fold-dump` and `resolution-dump` read one census
  (`bound-census.ts`, ~13 s), built once per process — name them in ONE `bun test` call to pay it once. Measured
  alone (2026-10-02): parse-census ~10 s, fixed-point ~10 s, type-dump / fold-dump ~16 s, resolution-dump ~27 s (it
  also runs the server's pass over the corpus), rules / bound-census < 1 s; the whole folder ~36 s (`test/baseline/` and `test/package/layering.test.ts`, < 1 s,
  were in it until openspec lsp-package-structure 2.2).
- **`bun run rate:fixtures` once, at the end** of a piece of work, not after every edit: the map carries project-wide
  totals, so there is no partial rewrite.
