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
| `Volt.Cli.Connector.Tests` | **76 pass / 0 fail** |
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

## Test files moved mechanically

_(the only permitted test edit: a test file following the type it covers. Anything else is a behavior change
wearing a costume.)_

## Close-out (task 6)

| | before | after |
|---|---|---|
| e2e CODESYS | | |
| e2e TwinCAT | | |
| total LOC | 15,295 | |
| files | 118 | |
| projects | 7 | |
