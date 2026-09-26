# Testing — what tests what

**Quick answer to "where do the tests live?"** Two places, and `scripts/` is **not** one of them:

- **`src/**/*.test.ts`** — unit tests, colocated next to the code they test (96 of them).
- **`test/`** — the cross-cutting suites: four concerns across six files. See [`test/README.md`](test/README.md).
- **`scripts/`** — **tooling, NOT tests.** Dev tools that talk to a live IDE to *produce* the ground-truth data
  the tests check against. `bun test` never runs them (it targets `src/` and `test/`). See
  [`scripts/README.md`](scripts/README.md).

Everything under `bun test` is **offline and deterministic** — no live IDE needed.

## By use case — "I want to test/understand X, where do I look?"

| I want to… | Look in | Layer |
|---|---|---|
| a **C-code** (a `Cnnnn` diagnostic) — is it emitted, with the right wording? | `test/catalog/catalog.test.ts` (master net, one test per code) **+** the check's own `src/analysis/checks/**/*.test.ts` | Unit |
| check a C-code matches the **real CODESYS/TwinCAT** byte-for-byte | run `scripts/verify-catalog.ts` (live) → stamps `docs/codesys-reference/error-catalog.json`; view status with `scripts/catalog-status.ts` | Tooling |
| a **language feature** — parse, resolve, hover, completion, signature, format, semantic tokens | colocated `src/syntax/`, `src/symbols/`, `src/services/**/*.test.ts` | Unit |
| a **graphical (network-text)** body | `src/network/*.test.ts` | Unit |
| prove a feature/diagnostic **agrees with the real compiler** | `test/conformance/fixtures.test.ts` (replays recorded IDE output — no live IDE) | Conformance |
| **no invented diagnostics on real projects** | `test/corpus/corpus.test.ts` | Corpus |

## The three test layers

| Layer | Where | What it proves | Oracle (source of truth) |
|---|---|---|---|
| **Unit** | `src/**/*.test.ts` | each module is correct in isolation (parser, binder, types, one check, one service) | the code's own spec — hand-written expectations |
| **Conformance** | `test/conformance/` | our diagnostics match the **real compiler**, byte-for-byte | `recordings/` — captured from live CODESYS/TwinCAT |
| **Corpus** | `test/corpus/` | **zero invented diagnostics** on real projects — every error and warning is one the IDE's own build emitted | `test-corpus/<project>/expected-build.codesys.json` — recorded live builds |

They layer, they don't overlap:
- **Unit** = white-box. "Does this function do what I wrote?"
- **Conformance** = black-box vs the compiler. "Do we *agree with CODESYS/TwinCAT*?" It runs our LSP on each
  `fixtures/` case and compares to the recorded IDE output. The live IDE is **not** hit here — `fixtures.test.ts`
  replays the JSON in `recordings/`.
- **Corpus** = black-box vs reality. "Does the LSP survive real code without crying wolf?" Every error and
  warning we emit on a corpus project must be one the IDE's own build also emitted. (It is NOT "a clean project
  produces no diagnostics" — the projects are not clean.)

### `test/`, in detail — four concerns, six files

**[`test/README.md`](test/README.md) is the map** and is not repeated here. In short: the file name is the
QUESTION, not the mechanism, and each concern owns one file.

```
test/
  conformance/
    fixtures/                input ST code + metadata (the cases)          <- authored by hand
    support/                 plc-prg.ts (the one PLC_PRG text) . standard-library.ts . evidence.ts
    recordings/
      codesys.build.json     what CODESYS's build said     <- scripts/record-language.ts (live bridge)
      twincat.build.json     what TwinCAT's build said     <- scripts/record-language.ts (TwinCAT worker)
      codesys.run.json       every variable after N scans  <- scripts/record-exec.ts (headless simulator)
    fixtures.test.ts         THE FIXTURE CONTRACT - one row per evidence rating, driving everything the
                             recordings can answer: the LSP's diagnostics vs the build, the interpreter and
                             the emitted Rust vs the run, and the rating itself recomputed
    backends.test.ts         interp vs emitted Rust, where no recording reaches
    suite.test.ts            is enough being ASKED - the census, our grammar, the vendor's index
    properties.test.ts       the memory model as properties
    source-map.test.ts       every mapping names a Rust line that exists
  libraries/
    standard.test.ts         the library repo's Standard: every body behind the exact materialized interface,
                             the version lookup, and the FBs (timers over a harness clock) in both backends
  corpus/
    corpus.test.ts           THE CORPUS - one walk, three questions: the LSP can read it, it invents nothing
                             (vs each project's recorded IDE build), and lowering is total over it
  catalog/
    catalog.test.ts          one test per documented Cnnnn
```

A **fixture** is only input. A **recording** is the ground truth, and each file has ONE recorder. The two
**ratchets** in `fixtures.test.ts` only ever move one way: exact per-vendor message agreement, and a ceiling per
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

## The tooling (in `scripts/` — NOT run by `bun test`)

Grouped by what they need. **Live** = a bridge must be up (see below). **Offline** = pure, runs under `bun`.

| Script | Live? | package.json | Job |
|---|---|---|---|
| `bridge.ts` | — | (lib) | named-pipe client (`call(op,body)`) the live scripts import |
| `bridge-fixture.ts` | — | (lib) | shared fixture (`openFixture()` → set/del/reset) for the recorders |
| `record-language.ts` | live | `record:language` | push every conformance fixture, build, capture IDE diagnostics → `test/conformance/recordings/` |
| `record-corpus-build.ts` | live | — | snapshot a corpus project's real IDE build → `corpus.test.ts` oracle |
| `refresh-corpus.ts` | live | `refresh:corpus <name>` | refresh a `test-corpus/<name>/` project by dogfooding `volt pull` |
| `verify-catalog.ts` | live | — | build every implemented C-code repro, confirm wording vs IDE → `error-catalog.json` verified flags |
| `record-gaps.ts` | live | — | probe unverified compiler-warning gap codes for their real trigger/wording (positive-control proven) |
| `audit-check.ts` | live | `audit:check <battery>` | ad-hoc "is this check right?" — LSP vs `/build` for a battery of cases; touches no test data |
| `conversion-matrix.ts` | live | — | validate `classifyConversion` against the live compiler for every numeric pair |
| `catalog-status.ts` | offline | — | render the C-code catalog status matrix (LSP / CS / TC) |
| `corpus-fp.ts` | offline | — | the zero-FP corpus oracle in a debuggable, grouped-by-code form (no test timeout) |
| `parser-completeness.ts` | offline | — | parser recovery evidence — both parser paths record zero on the (clean) corpus |
| `check-layering.ts` | offline | `lint` | fail on an illegal upward import between layers |

Bring a bridge up first (the data wire is a **named pipe**, not an HTTP port): CODESYS —
`pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys` (a GUI IDE; serves `volt.bridge.codesys.<pid>` when no
`VOLT_PIPE` is set — pass `VOLT_PIPE=volt.bridge.codesys.<pid>`); TwinCAT — run `VoltConnector.exe` and pick the
project from the tray (serves `volt.bridge.twincat`, XAE open on a project).

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
