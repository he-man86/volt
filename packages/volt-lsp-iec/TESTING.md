# Testing — what tests what

**Quick answer to "where do the tests live?"** Two places, and `scripts/` is **not** one of them:

- **`src/**/*.test.ts`** — unit tests, colocated next to the code they test (96 of them).
- **`test/`** — the two cross-cutting suites: `test/conformance/` and `test/corpus/`.
- **`scripts/`** — **tooling, NOT tests.** Dev tools that talk to a live IDE to *produce* the ground-truth data
  the tests check against. `bun test` never runs them (it targets `src test/conformance` + `test/corpus`). See
  [`scripts/README.md`](scripts/README.md).

Everything under `bun test` is **offline and deterministic** — no live IDE needed.

## By use case — "I want to test/understand X, where do I look?"

| I want to… | Look in | Layer |
|---|---|---|
| a **C-code** (a `Cnnnn` diagnostic) — is it emitted, with the right wording? | `src/reference/error-catalog.test.ts` (master net, one test per code) **+** the check's own `src/analysis/checks/**/*.test.ts` | Unit |
| check a C-code matches the **real CODESYS/TwinCAT** byte-for-byte | run `scripts/verify-catalog.ts` (live) → stamps `docs/codesys-reference/error-catalog.json`; view status with `scripts/catalog-status.ts` | Tooling |
| a **language feature** — parse, resolve, hover, completion, signature, format, semantic tokens | colocated `src/syntax/`, `src/symbols/`, `src/services/**/*.test.ts` | Unit |
| a **graphical (VG)** body | `src/graphical/*.test.ts` | Unit |
| prove a feature/diagnostic **agrees with the real compiler** | `test/conformance/` (replays recorded IDE output — no live IDE) | Conformance |
| **no false positives on real projects** that compile clean | `test/corpus/` | Corpus |

## The three test layers

| Layer | Where | What it proves | Oracle (source of truth) |
|---|---|---|---|
| **Unit** | `src/**/*.test.ts` | each module is correct in isolation (parser, binder, types, one check, one service) | the code's own spec — hand-written expectations |
| **Conformance** | `test/conformance/` | our diagnostics match the **real compiler**, byte-for-byte | `recordings/` — captured from live CODESYS/TwinCAT |
| **Corpus** | `test/corpus/` | **zero false positives** on real projects that compile clean | `test-corpus/` — real harvested projects |

They layer, they don't overlap:
- **Unit** = white-box. "Does this function do what I wrote?"
- **Conformance** = black-box vs the compiler. "Do we *agree with CODESYS/TwinCAT*?" It runs our LSP on each
  `fixtures/` case and compares to the recorded IDE output. The live IDE is **not** hit here — `replay.test.ts`
  replays the JSON in `recordings/`.
- **Corpus** = black-box vs reality. "Does the LSP survive real code without crying wolf?" A project that
  compiles clean in the IDE must produce **no** error diagnostics from us.

### Conformance, in detail (`test/conformance/`)

```
fixtures/     input ST code + metadata (the cases)          ← authored by hand
recordings/   what the real IDE said about each fixture     ← produced by scripts/record-language.ts
replay.test.ts  runs our LSP on each fixture, diffs vs the recording   ← the actual test
```

A **fixture** is only input. A **recording** is the ground truth. The **ratchet** (floors in `replay.test.ts`)
counts how many fixtures match the IDE byte-for-byte; it only ever rises. A fixture the IDE and LSP disagree on
for a documented reason is listed in `KNOWN_DIVERGENCES`.

### Corpus, in detail (`test/corpus/`)

| File | Gate |
|---|---|
| `corpus.test.ts` | every ST file parses; every body materializes; **zero error-severity FPs**; formatter round-trips |
| `build-conformance.test.ts` | every LSP error ⊆ what the IDE build actually emitted (`scripts/record-corpus-build.ts` snapshot) |
| `warning-conformance.test.ts` | LSP warnings vs the IDE build's warnings (coverage/FP, capped) |

### C-codes, in detail (the data pipeline)

The CODESYS `Cnnnn` catalog is data in `docs/codesys-reference/`, turned into tests + reports:

```
error-catalog.json  ── master checklist (status/ourCode/repro/verified per code)
   │
   ├─▶ src/reference/error-catalog.test.ts   one test per code: implemented→burn-in, checkable→todo, ide-only→skip
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
| `record-corpus-build.ts` | live | — | snapshot a corpus project's real IDE build → `build-conformance.test.ts` oracle |
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
`pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up` (headless; serves `volt.bridge.codesys.<pid>` when no
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
