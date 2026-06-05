# Volt agent — test layout

Five test layers, organized bottom-up by what each one needs. Pick the
shallowest layer that proves the behavior — deeper layers cost more to
run and need more setup. Every test file ends in `.test.ts` and is
picked up by `bun test`.

```
volt-agent/src/tests/
├── unit/              L2: pure-function tests on agent code
├── scenarios/         L3: in-process end-to-end via TestBridge
│   ├── pull/
│   ├── push/
│   ├── drift/         (move detection, child drift, config drift…)
│   ├── graphical/     (FBD/LD/SFC/CFC parents + nested children)
│   └── invariants/    (registry, vocabulary, access modes)
├── live/              L4 + L5: needs a running CODESYS or TwinCAT
├── fixtures/          shared test data (small "projects" for scenarios)
├── harness/           shared test infrastructure (TestEnv, runVerb, …)
└── README.md          (this file)
```

Bridge-side tests live in their own packages and aren't run by
`bun test`:

- `packages/volt-bridges/codesys/CodesysBridge.Tests/` — pytest, pure-function tests for st_splitter, plcopen_xml, block_type_mapper
- `packages/volt-bridges/beckhoff/BeckhoffBridge.Tests/` — xUnit, pure-function tests for CodeHelper, LanguageDetector, PlcOpenXml, StSplitter

## The five layers

### L1 — Bridge unit tests *(in the bridge packages, not here)*

Pure-function tests for the bridges' internal helpers — text splitters,
language detectors, PLCopenXML parsers. No COM/IDE. Run via the
language's native test runner (`python -m pytest` / `dotnet test`).
Fastest layer; <1 s.

### L2 — Agent unit tests (`tests/unit/`)

Pure-function tests on the agent's modules — transpiler, snapshot
healing, sweep-empty-dirs, wire schema validation. No TestBridge, no
fixtures, no workspace. Tests import the function under test directly
and call it with synthesized inputs. Fastest layer on the agent side;
<1 s.

When a new test belongs here:
- it exercises one engine/cli/bridge module in isolation
- the inputs and expected outputs are small data structures, not
  workspace files
- it has no use for a verb (pull/push/status) — it just tests one
  function

### L3 — Scenarios (`tests/scenarios/<category>/`)

End-to-end tests that invoke real CLI verbs (`pullVerb`, `pushVerb`,
…) against an in-process simulator (`bridge/test-bridge.ts`). Each
scenario:

1. boots a temp workspace via `harness/make-test-env.ts`
2. seeds a `TestBridge` with one of the `fixtures/projects/*` fixtures
3. drives verbs via `harness/run-verb.ts`
4. asserts on the workspace tree via `harness/assert-workspace.ts`

No live IDE, deterministic, parallelizable. The TestBridge faithfully
implements the wire contract that both real bridges must satisfy, so a
scenario that passes here is a contract test against both
implementations.

Categories:

| Subfolder | What it covers |
|---|---|
| `pull/` | clean pull, retired items, force pull |
| `push/` | source push, refusal on read-only / config items |
| `drift/` | every shape of IDE→workspace drift: child elements, config-version, move, unknown-language |
| `graphical/` | top-level graphical POUs, mixed-language FBs (ST parent + graphical children) |
| `invariants/` | static contracts: bridge↔agent vocabulary, extension registry, access modes |

When a new test belongs here:
- it tests how the agent reacts to bridge inputs / workspace edits
- the assertion is "what files exist in the workspace" or "what op
  did push emit"
- you can model the bridge behavior using `TestBridge` (any wire shape
  both real bridges must produce)
- adding a fixture is OK; reusing one of `fixtures/projects/*` is better

### L4 — Live wire-invariants (`tests/live/wire-invariants.test.ts`)

Read-only probes against a running bridge (`/refs`, `/fetch`, …). No
mutations to the IDE project — safe to run against any open project,
including production. Asserts:

- per-item version is content-addressed (stable across back-to-back
  `/refs`)
- `FetchResponseSchema` validates on real wire data
- `graphicalChildren` entries are well-formed
- declaration-only kinds omit `language`
- no item carries `language: "UNKNOWN"`
- top-level graphical POUs carry `implementationXml`

Skipped unless `VOLT_TEST_BRIDGE_PORT` is set (8555 = TwinCAT,
8556 = CODESYS). Run the same file against both bridges to verify
parity:

```sh
VOLT_TEST_BRIDGE_PORT=8556 bun test src/tests/live/wire-invariants.test.ts
VOLT_TEST_BRIDGE_PORT=8555 bun test src/tests/live/wire-invariants.test.ts
```

When a new test belongs here:
- it asserts a property the wire MUST satisfy regardless of IDE state
- it doesn't mutate the IDE project
- it's safe to run against production projects

### L5 — Live full-cycle (`tests/live/full-cycle.test.ts`)

Round-trip tests that mutate IDE state: pull → workspace edit → push
→ re-pull, plus move tests that drag a sandbox POU between folders.
Expects the open IDE project to match the [sandbox project
spec](./live/SANDBOX.md). Restores state in `afterAll` so re-runs are
idempotent.

Skipped unless `VOLT_TEST_BRIDGE_PORT` is set. Same gating as L4.

When a new test belongs here:
- it needs to verify that the bridge's COM/scripting layer behaves
  correctly under writes, not just reads
- it can be cleaned up after the test runs
- the assertion can't be made against the in-process `TestBridge`
  (because the behavior is bridge-internal, not wire-shape)

## How to add a new test

1. **Figure out the layer.** Use the decision tree:
   - Pure function on agent code? → `unit/`
   - Verifies how the agent reacts to bridge inputs? → `scenarios/<category>/`
   - Asserts a wire-contract property the live bridge must satisfy? → `live/wire-invariants.test.ts`
   - Asserts a write-side behavior of the real bridge? → `live/full-cycle.test.ts`
   - Pure function on bridge code? → bridge package's own test dir
2. **Pick the file name** to match the behavior under test (kebab-case,
   ends in `.test.ts`).
3. **For L3 scenarios**, drop in the appropriate category folder. If
   the category doesn't fit, add a new subfolder and document it here.
4. **For L4 / L5**, ADD the test to the EXISTING file rather than
   creating a new one — keeps the live-bridge setup cost amortized
   across tests.

## Running the suite

```sh
bun test                          # everything — unit + scenarios; live skipped
bun test src/tests/unit/          # just L2
bun test src/tests/scenarios/     # just L3
bun test src/tests/scenarios/drift/  # just drift scenarios

VOLT_TEST_BRIDGE_PORT=8556 bun test src/tests/live/  # live against CODESYS
VOLT_TEST_BRIDGE_PORT=8555 bun test src/tests/live/  # live against TwinCAT
```

## Cross-bridge parity policy

The agent is bridge-agnostic. Wire shape, kind vocabulary, version
semantics, and feature surface MUST be identical between CODESYS and
TwinCAT — see `[[feedback_bridges_must_stay_at_parity]]`. When you
add a scenario covering a wire property, you implicitly cover both
bridges (because both must produce the same shape). When you add a
live test, run it against both bridges before merging.
