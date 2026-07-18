# Testing — what tests what

Everything under `bun test` is **offline and deterministic** (no live IDE needed). The live CODESYS/TwinCAT
bridge is touched only by the **tooling** in `scripts/`, run by hand to *produce* the data the tests check against.

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

### Conformance, in detail

```
fixtures/     input ST code + metadata (the cases)          ← authored by hand
recordings/   what the real IDE said about each fixture     ← produced by scripts/record-language.ts
replay.test.ts  runs our LSP on each fixture, diffs vs the recording   ← the actual test
```

A **fixture** is only input. A **recording** is the ground truth. The **ratchet** (floors in `replay.test.ts`)
counts how many fixtures match the IDE byte-for-byte; it only ever rises. A fixture the IDE and LSP disagree on
for a documented reason is listed in `KNOWN_DIVERGENCES`.

## The tooling (in `scripts/` — NOT run by `bun test`)

These talk to a **live bridge** to produce the data above. Run them by hand when refreshing ground truth.

| Script | package.json | Feeds | Job |
|---|---|---|---|
| `record-language.ts` | `bun run record:language` | `test/conformance/recordings/` | push every fixture to a live bridge, build, capture the IDE's diagnostics. Non-destructive by default (writes `*.new.json` + prints the diff vs committed); `--write` adopts it. Vendor auto-detected from the bridge. |
| `refresh-corpus.ts` | `bun run refresh:corpus <name>` | `test-corpus/<name>/` | refresh a corpus project by dogfooding `volt pull` (a temp `volt init` → its `src/` tree); preserves the build oracle. |
| `audit-check.ts` | `bun run audit:check <battery>` | nothing — prints to screen | ad-hoc "what does the live IDE say vs our LSP" for a battery of cases. The tool for *is this check actually right?* (it's what proved `constant-overflow` was wrong). Touches no test data. |
| `check-layering.ts` | `bun run lint` | nothing — lint | fails on an illegal upward import between layers. |

Bring a bridge up first: `pwsh packages/volt-bridge/scripts/codesys-bridge.ps1 up` (CODESYS :8556) or
`pwsh packages/volt-bridge/scripts/bridge.ps1 -Port 8555` (TwinCAT, XAE open on a project).

## Running

```bash
cd packages/volt-lsp-iec
bun test                       # all three layers, offline
bun test src/types             # just the type unit tests
bun test test/conformance      # just conformance replay
bun run typecheck              # everything: src + test (incl. *.test.ts) + scripts (tsconfig.json). Build = tsconfig.build.json
bun run lint                   # layering check
```
