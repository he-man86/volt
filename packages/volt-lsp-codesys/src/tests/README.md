# Volt LSP-ST — test layout

Four test layers + a placeholder for a future fifth, organized
bottom-up by what each one needs. Pick the shallowest layer that proves
the behavior — deeper layers cost more to run and need more setup.
Every test file ends in `.test.ts` and is picked up by `bun test`.

```
volt-lsp-codesys/src/tests/
├── unit/              L1: pure-function tests (parser, lexer, semantic, reference, init)
├── scenarios/         L2: end-to-end LSP queries — parser + symbol table + query layer
│   ├── queries/       (definition, references, completion, hover, semantic-tokens, …)
│   └── server/        (LSP server protocol — initialize, didOpen, didChange, …)
├── conformance/       L3: snapshot-replay against recorded IDE ground truth
│   ├── corpus/        (per-LSP-query corpus tests: 15 files, one per query)
│   ├── language.test.ts (LSP-vs-IDE diagnostics agreement)
│   ├── _shared.ts     (test-only fixture builders)
│   └── __snapshots__/ (per-file snapshot dirs; one .snap per .test.ts)
├── live/              L4: needs a running TwinCAT/CODESYS LSP target (PLACEHOLDER)
└── README.md          (this file)
```

The `src/conformance/` directory next to this one carries the PUBLIC
`./conformance` package export — `fixtures/`, `types.ts`, `index.ts`,
`recordings/`. Tests live here; the catalog they consume lives there.

## The four layers

### L1 — Unit tests (`tests/unit/`)

Pure-function tests on individual modules — `parser`, `lexer`,
`semantic/{body, diagnostics, resolver, symbol-table}`, `reference`,
`init`. Tests import the function under test directly and call it with
synthesized inputs. No LSP integration, no fixture catalog. Fastest
layer; <1 s.

When a new test belongs here:
- it exercises one module in isolation (e.g. just the parser, just the
  symbol-table builder)
- the inputs and expected outputs are small data structures (parse
  trees, scope maps), not LSP protocol messages
- it has no use for an open `Workspace` or cross-file resolution — it
  tests one function

### L2 — Scenarios (`tests/scenarios/<category>/`)

End-to-end tests that run an LSP query against a constructed
`Workspace` containing one or more `Document`s. Each query test:

1. builds a workspace (often one POU + a synthesized PLC_PRG so
   cross-file resolution can be exercised)
2. drives an LSP query (`hover`, `definition`, `references`, …)
3. asserts on the LSP response shape

Categories:

| Subfolder | What it covers |
|---|---|
| `queries/` | per-query integration: completion, definition, document-symbol, namespace, navigation, references, rename, semantic-tokens |
| `server/`  | LSP server protocol — `initialize`, `didOpen`, `didChange`, request routing |

When a new test belongs here:
- the assertion is "what did this LSP query return for this code?"
- the test builds a `Workspace` with one or more open documents
- it can be modeled without recorded IDE ground truth — the LSP's
  own output is the thing under test

### L3 — Conformance (`tests/conformance/`)

Snapshot-replay tests that pin every LSP query's output across the
full language-test corpus (`src/conformance/fixtures/`). The catalog
is fed through each query once per test file; the response is
snapshotted and any future drift surfaces as a snapshot diff. The
`language.test.ts` test goes further and compares the LSP's
semantic diagnostics against ground-truth recordings from the real
IDEs (`expected-tc.json`, `expected-codesys.json`).

Recordings are populated out-of-band by `bun run record:language`
against the matching bridge (`VOLT_BRIDGE_PORT=8555` for TwinCAT,
`=8556` for CODESYS). The REPLAY runs pure — no live bridge required.

When a new test belongs here:
- you want every test in the language catalog automatically exercised
  against a new LSP query
- a recorded IDE comparison is needed (the LSP should agree with the
  compiler, modulo documented exemptions)
- the failure mode you're hunting only shows under combinatorial
  coverage — single-feature unit tests don't catch it

### L4 — Live LSP tests (`tests/live/`) *(placeholder)*

Reserved for tests that drive the LSP against a live IDE or run the
LSP server against a real bridge's project state. Currently empty;
the L3 conformance tests already replay recorded IDE truth so most
"does the LSP agree with TC/CODESYS" questions are answered without
needing live runs.

Add tests here when:
- you need to verify the LSP behaves correctly under an editor's
  actual didChange/didSave traffic patterns
- the bug only reproduces with the LSP serving a real workspace, not
  in-process `Workspace` calls

## How to add a new test

1. **Figure out the layer.** Use the decision tree:
   - Pure function on one module? → `unit/`
   - Drives an LSP query against a constructed workspace? →
     `scenarios/queries/` (or `scenarios/server/` for protocol-level)
   - Snapshots every catalog entry for a new query, or compares against
     recorded IDE truth? → `conformance/`
   - Needs a real editor / live bridge? → `live/`
2. **Pick the file name** to match the behavior under test (kebab-case,
   ends in `.test.ts`).
3. **For L2 scenarios**, drop in the appropriate category folder. If
   the category doesn't fit, add a new subfolder and document it here.
4. **For L3 conformance corpus**, add one corpus test per query. New
   LSP queries get a new corpus file in `conformance/corpus/`.

## Running the suite

```sh
bun test                                # everything (L1 + L2 + L3; L4 is placeholder)
bun test src/tests/unit/                # just L1
bun test src/tests/scenarios/           # just L2
bun test src/tests/scenarios/queries/   # just the LSP queries
bun test src/tests/conformance/         # just L3 (corpus + language)
```

To re-record the IDE ground truth that L3's `language.test.ts` checks
against:

```sh
VOLT_BRIDGE_PORT=8555 bun run record:language     # TwinCAT
VOLT_BRIDGE_PORT=8556 bun run record:language     # CODESYS
```
