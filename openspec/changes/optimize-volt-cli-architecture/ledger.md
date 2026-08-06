# Move ledger

Phase 5. One row per executed move, written by the main loop after the gate — never by an agent, and never
before the gate.

## Baseline (task 0)

| | value |
|---|---|
| shape | 118 files / 15,295 LOC / 7 projects (excl. generated `obj/`) |
| per project | `Volt.Engine` 6,686 · `Volt.Cli` 2,122 · `Volt.Cli.Connector` 1,816 · `Volt.Cli.Ide.Codesys` 1,799 · `Volt.Cli.Ide.Twincat` 1,311 · `Volt.Cli.Connector.Core` 1,129 · `Volt.Cli.Transport` 432 |
| build | **0 errors, 18 warnings** (Release, 2026-08-05) |
| `Volt.Engine.Tests` | **324 pass / 0 fail** (RUNBOOK said 313 — `audit-volt-cli-src` added 11 in flight) |
| `Volt.Cli.Tests` | **116 pass / 0 fail** |
| `Volt.Cli.Connector.Tests` | **76 pass / 0 fail** → **75 from move 5** (a test deleted with its subject; see the table below) |
| **e2e CODESYS (before)** | **92 pass / 8 skip / 0 fail** (headless fixture, pid 31104, after the harness fix) |
| **e2e TwinCAT (before)** | **88 pass / 11 skip / 2 fail** — was 24/11/63; the save defect was fixed first, see below |
| known red | `ide-restart` recovery test — diagnosed, out of scope, not a regression |

A red baseline invalidates every verdict after it. Re-run before trusting anything below.

### The first e2e attempt was void — it ran against the wrong IDE

A headless fixture bridge was up on `volt.bridge.codesys.31104` and `VOLT_PIPE` named it. The suite ran against
`volt.bridge.codesys.37100` — a developer's interactive `Untitled1.project` — and reported 90 pass / 8 skip /
2 fail. The two failures (`conflict-resolve`, `pull` → `refused`) are consistent with an unbound non-fixture
project and are **not** evidence about the product.

Cause, `test/e2e/harness.ts:41`: the pipe filter's third clause `n.startsWith('volt.bridge.<vendor>.')` matched
*every* pipe of the vendor, so an explicit `VOLT_PIPE` was advisory rather than exclusive — a defensive
fallback that silently retargeted the whole suite (`ARCHITECTURE.md` §Conventions rule 1). The clause is
redundant when `VOLT_PIPE` is unset (`startsWith(PIPE_PREFIX + '.')` already matches every pid pipe) and
harmful when it is set, so it is **deleted**. Test-infra fix, taken before phase 5 opens; it changes which
bridge the suite targets, never what it asserts.

Anything created in that live project is named `VltE2E_*`. The suite cleans up by prefix, but it was pointed
somewhere it was never meant to go — verify before trusting that project.

### The TwinCAT e2e baseline is RED, and it is a product defect — not this change's

Two live XAEs (fixtures 13 + 14, pids 2440 / 18420), connector up, both worker pipes serving. Result:
**24 pass / 11 skip / 63 fail**, and **55 of the failures are one error**:

```
INTERNAL_ERROR: the IDE could not save the applied changes, so they are NOT committed to disk:
'System.__ComObject' does not contain a definition for 'Save'
```

`Volt.Cli.Ide.Twincat/Ide/TcObjectModel.cs:421` calls `_dte.Solution.Save()` through late-bound COM. The live
error says the object has no such member — EnvDTE's solution interface exposes `SaveAs`, not `Save`. So **the
solution save has never worked**; until `838c4140e1` ("a failed TwinCAT save must fail the push, not be
swallowed") it was inside a bare `catch { }` and invisible.

That commit predicted exactly this: *"if the save was failing, that failure was invisible, so the next live run
is now diagnostic instead of silent."* **This is that run.** It is the mechanism behind the open durability bug
already recorded in `openspec/changes/fix-push-data-loss` (§3, and the bug-2 root-cause commit `1113500cf7`:
the content is written but the `.plcproj` that registers it never is).

Consequences for this change, stated rather than worked around:

- The pre-change TwinCAT e2e gate **cannot be green today**, so "green before and after" holds on **CODESYS**
  and on the **TwinCAT 24 that pass**. The 63 are the baseline, red, with a named cause.
- It is **not fixed here**. It is a behavior change on the data-loss path needing two-vendor live verification,
  and it belongs to `fix-push-data-loss`. It goes on the known-defects list every agent in this change is given.
**Resolved 2026-08-05 — the save was fixed before the baseline was accepted.** `Solution.Save()` → one
`_dte.ExecuteCommand("File.SaveAll")`, the shell command behind File > Save All: it exists, and it persists open
documents, every dirty project (the `.plcproj` whose missing registration IS the orphan bug) and the solution.
Belongs to `openspec/changes/fix-push-data-loss` §3/§4.2, recorded there.

**TwinCAT e2e: 24 pass / 63 fail → 88 pass / 2 fail**, reproduced twice. The fix had to be verified against a
worker built from this tree: the connector was spawning the INSTALLED `app-0.1.16027` binaries, so the first
baseline measured shipped bits, not the repo. Re-run with `VOLT_TWINCAT_BRIDGE` pointed at
`src/Volt.Cli.Ide.Twincat/bin/Release/net8.0-windows/VoltBridgeTwincat.exe`. Build + all three unit suites stay
green (324 / 116 / 76).

**The 2 remaining failures are PARKED, with evidence.** Both are `lifecycle/conflict-resolve`, and they are
**order-dependent suite coupling, not a defect in the pull path**:

- run alone against a stable XAE: **2 pass / 0 fail**;
- run inside the full suite: 2 fail, `pull` → `error`, twice reproducibly;
- `volt init` + `volt pull` by hand against the same XAE both exit 0, with and without `VOLT_PIPE` — so
  `BridgeResolver` and the pull path are both fine in isolation.

Something earlier in the suite leaves the bridge in a state a later `pull` can't use (`disconnect-cycle` is the
obvious suspect — disconnect gates the whole bridge, and the session/interest model decides when it comes back).
That is a question about the connector/session architecture, which is what this change is here to examine, so it
is parked as a phase-2 input rather than patched now. On the known-defects list.

Environment note for whoever re-runs this: TcXaeShell is unstable. One fixture's shell closed and reopened
mid-session (new pid → new worker → new pipe), and a stale pipe from the replaced instance was briefly visible.
Confirm 2 XAEs / 2 workers / 2 pipes before trusting a TwinCAT number, and re-run anything conclusive twice.

## Moves

| # | move | files touched | LOC before → after | verifier | gate | commit |
|---|---|---|---|---|---|---|
| 1 | `connector-test-orphans` (shape) | 2 | 803 → 800 | *(applied directly — 3 lines)* | build 0 err · 324/116/76 | `1299a6e1f1` |
| 2 | `delete-debug-surface` (shape) | 11 | 2,655 → 2,353 | **accept**, 0 must-revert | build 0 err · 324/116/76 | `fb4c660fda` |
| 3a | `delete-pou-to-xml` — the inert half (shape) | 1 | −92 | **accept**, 0 must-revert | build 0 err · 324/116/76 | `79641dfd6d` |
| 3b | `delete-pou-to-xml` — BodyLanguage fields (shape) | 3 | −5 | *(same verdict; split per amendment)* | build 0 err · 324/116/76 | `fc161d4f24` |
| 4 | `one-st-emitter` (shape) | 8 | 1,044 → 870 | **accept**, 0 must-revert | build 0 err · 324/116/76 | `fadb86ab8f` |
| 5 | `delete-dead-spawn-plan` (shape, **narrowed**) | 3 | 650 → 622 | **accept**, 0 must-revert | build 0 err · 324/116/**75** | `9396b2ded1` |
| 6 | `voltlog-down-to-transport` (shape, **relocation**) | 18 | 3,175 → 3,163 | **accept**, 0 must-revert | build 0 err · 324/116/75 · **+ HEAD built in a clean worktree** | `726f4959e8` |
| 7 | `unsilence-the-accept-loop` (**fix**) | 3 | 470 → 529 | **accept**, 0 must-revert | build 0 err · 324/**117**/75 · **red-first verified** | `e687b78c28` |
| 8 | `bridge-drops-go-to-voltlog` (**fix → reclassified shape-adjacent ADD**) | 2 | +12/−2 | **accept**, 0 must-revert | build 0 err · 324/117/75 | `787a84cc40` |
| 9 | `one-log-path` (**fix → reclassified shape**) | 11 | 2,065 → 2,032 | **accept**, 0 must-revert | build 0 err · 324/117/75 | `8b904728a8` |
| 9b | `prune-only-your-own-logs` (**fix**, unplanned — forced by 9) | 2 | +12/−2 | *(main loop; red-first verified)* | build 0 err · **325**/117/75 | `7fe9c1ccc9` |

## Test files moved mechanically

_(the only permitted test edit: a test file following the type it covers. Anything else is a behavior change
wearing a costume.)_

| test file | move | what changed |
|---|---|---|
| `test/shared/FakeIde.cs` | 2 | three stubs deleted — they implemented interface members that no longer exist |
| `test/Volt.Engine.Tests/FbdCorpusRoundTripTests.cs` | 2 | comment only: the corpus's provenance cited `DebugService.RawBodies` and promised a harvester that no longer ships |
| `test/Volt.Engine.Tests/WireVocabularyGuardTests.cs` | 3b | allowlist entry for the deleted `PouToXml.cs` removed — the guard gets NARROWER; `[Fact]`, regex, vocabulary lists and `Assert` byte-identical |
| `test/Volt.Engine.Tests/ChildDirectiveTests.cs` | 4 | ARRANGE repointed at the shipped emitter (premise "StAssembler is the format under test" was false — nothing ships it). Every pre-existing assertion unchanged; **gained** a golden `Assert.Equal` on the full emitted text |
| `test/Volt.Engine.Tests/InterfaceRoundTripTests.cs` | 4 | same, same |
| `test/Volt.Cli.Connector.Tests/TwincatSupervisorTests.cs` | 5 | **coverage DELETED, not adapted**: one case + five assertions drove `Forget`/`SpawnedPids`, the members this move removes. Suite **76 → 75**. Every surviving case keeps its behavioural assertion; no assertion text or expected value changed |

## Fix moves — the red-first proof

A `fix` move's whole warrant is that a test failed against the OLD behaviour. That is verified here by stashing
the move's src files and running the new test alone — not taken from the surgeon's report.

| # | move | the test | RED against HEAD said |
|---|---|---|---|
| 7 | `unsilence-the-accept-loop` | `PipeTransportTests.A_bridge_whose_pipe_cannot_be_bound_fails_Start_instead_of_reporting_ready` | `Assert.ThrowsAny() Failure: No exception was thrown` — i.e. `Start()` returned normally while the pipe never bound |
| 9b | `prune-only-your-own-logs` | `VoltLogTests.Retention_prunes_only_this_sources_own_files` | `retention deleted a file this source does not own` — `Prune()` globbed `*.log` and swept Setup's `install-*.log`, which `LogWindow` bundles for support and `scripts/test-install.ts` reads |
| 8 | `bridge-drops-go-to-voltlog` | **none, and none owed** | the amendments turned a substitution into a pure ADD; an ADD corrects nothing, so there is no old behaviour to be red against. Reclassified out of `fix` rather than granted an exemption. (A test could not reach these sites regardless: `Volt.Cli.Ide.Codesys` is net48, every test csproj is net8.0.) |

## Bugs found and fixed while executing (not on the phase-3 list)

| bug | found by | fixed in |
|---|---|---|
| `VoltLog.Prune()` deleted every component's logs, not its own — destroying Setup's `install-*.log` that the support bundle surfaces and `scripts/test-install.ts` reads. Pre-existing; move 9 turned it from rare (a bridge activates) into certain (every tray start) | move 9's verifier, from the card's own unheeded `riskiestPart` | `9b`, red-first, immediately — not deferred to "before the next release" |

## Process defects found while executing

**Move 6 — the gate tests the working tree; the commit is a subset of it.** The first commit of move 6 did NOT
compile, while the gate was green. A relocation creates a new path, and `git add src/Volt.Engine` cannot reach a
file now living in `src/Volt.Cli.Transport` — so the new path was committed with its ORIGINAL content (old
namespace) while every `using` of it was deleted. The working tree was correct throughout, which is exactly why
the gate passed.

Caught by reading `git show --stat`, noticing the relocated file reported **0 changed lines** when it should have
reported one, and then checking `git show HEAD:<path>`. Fixed by amend (nothing was pushed) and verified by
building **HEAD itself** in a detached worktree rather than the working tree.

Two rules added to the runbook (§0.6b): after committing a move, `git status --porcelain` must show nothing of
the move left; and any relocation stages both paths and verifies the committed content directly. Moves 1–5 were
not exposed — none of them created a new path.

## Close-out (task 6)

| | before | after |
|---|---|---|
| e2e CODESYS | | |
| e2e TwinCAT | | |
| total LOC | 15,295 | |
| files | 118 | |
| projects | 7 | |
