# Runbook — run one phase in a clean context

## ▶ RESUME HERE

**Next move: 8 of 24** (`bridge-drops-go-to-voltlog`). Phases 1–4 are complete; execution is under way.

To continue in a fresh session, from the repo root:

```
Workflow({ scriptPath: "<phase5-move.js>", args: { order: <N> } })
```

The script is session-scoped; if its path is gone, re-create it from `design.md` §Phase 5 — the only subtlety
is that it passes `{order}` ONLY, and the agents read the card from
`openspec/changes/optimize-volt-cli-architecture/moves.json`. That indirection is deliberate: hand-transcribing
cards into workflow args dropped files and cost ~20 phase-4 skeptics.

Then: revert any `mustRevert` → **if the move is a `fix`, PROVE RED-FIRST** (`git stash` its src files, run the
new test alone, confirm it fails for the right reason, `git stash pop`) → gate (§4) → append to `ledger.md` →
commit (`refactor(cli):` for a shape move, `fix(cli):` for a fix move) `move N/24 — <title>` → bump the number
above, and check §0.6b.

**Nothing is lost if a session dies.** Every landed move is its own gated commit; an interrupted move leaves an
uncommitted tree that `git checkout --` discards. Workflow agent results are journaled per agent, so
`resumeFromRunId` replays the finished ones from cache and re-runs only the failures (phase 4 lost 7 of 55
skeptics to a session limit and kept the other 47).

Landed so far: **1** `connector-test-orphans` · **2** `delete-debug-surface` · **3a/3b** `delete-pou-to-xml` · **4** `one-st-emitter` · **5** `delete-dead-spawn-plan` · **6** `voltlog-down-to-transport` · **7** `unsilence-the-accept-loop`.


Read `proposal.md` for why, `design.md` for the five phases and the agent roles, this file to *execute*.
Phases 1–4 write only `map.md` / `findings.md` / `target.md`. Phase 5 writes source, one move at a time.

## 0. Non-negotiables (each one cost real time to learn — carried over from the audit)

1. **`dotnet` on PATH is an x86 stub with no SDK.** Always `C:\Program Files\dotnet\dotnet.exe`.
2. **A running headless CODESYS holds the net48 bridge DLLs — the build FAILS while it is up** (`MSB3027`).
   The order is always **`codesys down` → build → unit tests → `codesys up` → e2e**.
3. **There are THREE C# suites:** `Volt.Engine.Tests` (**324**), `Volt.Cli.Tests` (**117** — +1 from move 7),
   `Volt.Cli.Connector.Tests` (**75** — was 76 until move 5 deleted a test with its subject). Engine was 313
   before `audit-volt-cli-src` added 11 in flight. **A count that drops without a ledger row is a regression.**
3b. **`pwsh` is NOT installed on this machine.** Every doc that says `pwsh scripts/foo.ps1` means
   `& "…\scripts\foo.ps1"` under Windows PowerShell 5.1. `pwsh` fails with `CommandNotFound`, and in a compound
   command that failure is easy to read past.
3c. **The connector spawns the INSTALLED worker, not your build.** `ConnectorSetup.ResolveWorker` prefers the
   exe next to the connector, so a tray started from `%LOCALAPPDATA%\Programs\Volt\app-*` runs SHIPPED bridge
   binaries and your `dotnet build` changes nothing you can observe. To test a repo build: stop the connector +
   workers, build, then relaunch the connector with
   `$env:VOLT_TWINCAT_BRIDGE = "<repo>\src\Volt.Cli.Ide.Twincat\bin\Release\net8.0-windows\VoltBridgeTwincat.exe"`.
   Verify with `Get-Process VoltBridgeTwincat | Select Path` — this cost a whole misread baseline.
3d. **`codesys-pipe.ps1 down` does not close an interactive CODESYS.** It manages only the headless instance it
   started. A developer's own IDE keeps serving its pipe and will hold the net48 DLLs.
4. **Never run e2e until the per-pid pipe exists.** Wait for `\\.\pipe\volt.bridge.<vendor>.<pid>`; a bare
   `volt.bridge.codesys` with no pid suffix means nothing is up, and a cold run reports phantom failures.
5. **Agents never run `dotnet build`/`dotnet test`.** Concurrent builds corrupt each other's `obj/bin`, and an
   agent that gates itself rationalizes a red gate. The gate is serial, run by the main loop.
6. **Stage explicitly.** The TwinCAT fixtures under `test/TwinCAT Project*/` are rewritten by the IDE whenever
   it builds; `git commit -a` sweeps that churn in.
6b. **THE GATE TESTS THE WORKING TREE, THE COMMIT IS A SUBSET OF IT.** This bit on move 6 and produced a
   commit that did not compile while the gate was green. A relocation creates a NEW path, and
   `git add src/Volt.Engine` cannot reach a file that now lives in `src/Volt.Cli.Transport` — so the new path
   was committed with its ORIGINAL content (old namespace) while every `using` of it was deleted. Two rules,
   both cheap:
   - after committing a move, run `git status --porcelain` and confirm **nothing of the move is left** — a
     leftover means the commit is incomplete, whatever the gate said;
   - for any move that renames or relocates, `git add -A <old-path> <new-path>`, and verify the committed
     content directly: `git show HEAD:<new-path> | head`.
   For a relocation it is worth proving the COMMIT builds, not just the tree:
   `git worktree add --detach %TEMP%\volt-headcheck HEAD` → build there → `git worktree remove --force`.
7. **Known red, not a regression:** `ide-restart`'s second test. Root cause is the top entry of
   `audit-volt-cli-src/arch-notes.md`. Do **not** "fix" the test, and do **not** fix the defect inside a move.

## 1. The known-defects list every agent gets

Paste this into every agent prompt, all five phases. These are *diagnosed* defects, out of scope by
construction — **report and step around, never fix**:

- the not-connected precondition has two answers (live in `RefsService`, cached in `OpGuard` via
  `BuildHealthResponse`) — `audit-volt-cli-src/arch-notes.md` top entry;
- `DriverBase.SingleFlight` swallows the health-probe failure;
- `test/shared/FakeIde.cs` asserts `IsConnected` and `BuildHealthResponse().Connected` are the same signal —
  an invariant the real TwinCAT driver breaks. **In this change that is a phase-2 finding** (a fake that must
  lie names a misplaced seam), not something to patch in passing;
- a CFC/SFC POU **child** body is flattened on push;
- a pushed item does not survive the TwinCAT IDE being killed;
- `DebugService` is unreachable from any client while `ARCHITECTURE.md` says otherwise.

Keep it current as phase 2 finds more.

## 2. Constraints every agent gets (verbatim, all phases)

- `packages/volt-cli/ARCHITECTURE.md` §"Load-bearing asymmetries" and §"Conventions" are **constraints**, not
  suggestions. A proposal that unifies an asymmetry or breaks a convention is disqualified, not debated.
- **item-name-is-identity** — the whole wire is keyed by bare item name. Never propose a duplicate-name guard
  that throws.
- Static search does **not** prove code dead: reflection, `dynamic`, the IronPython entry point, COM and
  string-keyed `Ops` dispatch all reach code with no compile-time reference.
- No new dependencies. No DI container. No framework.
- `ponytail:` comments are recorded decisions — carry them, never silently delete one.

## 3. Phases 1–4 (analysis — nothing on disk but the working docs)

| phase | workflow shape | agents | writes |
|---|---|---|---|
| 1 Map | `parallel(7 cartographers + 1 seam analyst)` | 8 | `map.md` |
| 2 Diagnose | `parallel(7 lenses)` | 7 | `findings.md` |
| 3 Design | `parallel(3 architects)` → `parallel(3 judges)` → 1 synthesizer | 7 | `target.md` |
| 4 Refute | `pipeline(moves, refute×3)` | 3× moves | deferrals into `findings.md` |

Cartographer groups = one per project, exactly as they exist today:

| project | files | LOC |
|---|---|---|
| `Volt.Engine` | 52 | 6,686 |
| `Volt.Cli` | 16 | 2,122 |
| `Volt.Cli.Connector` | 11 | 1,816 |
| `Volt.Cli.Ide.Codesys` | 8 | 1,799 |
| `Volt.Cli.Ide.Twincat` | 10 | 1,311 |
| `Volt.Cli.Connector.Core` | 12 | 1,129 |
| `Volt.Cli.Transport` | 9 | 432 |

The 8th agent is the **seam analyst**: `.csproj` refs + `Volt.Cli.sln` + every cross-project call site. It is
the only agent that sees the whole graph, and its output is what phase 3 reasons over.

**All agents return schema-forced JSON. The main loop writes the markdown** — N agents appending to one file
concurrently corrupts it.

**Phase 3 ends at a user checkpoint.** Read `target.md` whole before phase 4. Nothing has changed on disk.

## 4. Phase 5 — per move

```
Workflow: pipeline([move], surgeon, verify)     # 2 agents; the surgeon writes only this move's files
```

Then, serially, in the main loop:

```powershell
# revert every must_revert hunk FIRST
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 down
$d = "C:\Program Files\dotnet\dotnet.exe"; $r = "packages\volt-cli"
& $d build "$r\Volt.Cli.sln" -c Release --nologo
& $d test "$r\test\Volt.Engine.Tests"        -c Release --nologo   # expect 313
& $d test "$r\test\Volt.Cli.Tests"           -c Release --nologo   # expect 116
& $d test "$r\test\Volt.Cli.Connector.Tests" -c Release --nologo   # expect 76
```

Verdicts: `accept` → gate · `accept-with-reverts` → revert `mustRevert`, then gate · `reject` →
`git checkout --` the move's files and re-queue with the objection. Then append to `ledger.md` (move, files,
LOC before → after, verdict, gate result) and commit `refactor(cli): <move>`, staging explicitly.

**Moves run one at a time.** Unlike the audit, a move touches two places by definition, so file-partitioning
cannot make concurrency safe — serial execution is the safety property, and it is what keeps each commit
independently revertable.

## 5. e2e — before, mid, after

```powershell
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up      # rebuilds the bridge first; ~45 s to serve
# WAIT for \\.\pipe\volt.bridge.codesys.<pid>, then:
cd packages/volt-cli; bun run test:e2e:codesys          # expect 92 pass / 8 skip / 0 fail

pwsh scripts/twincat-instances.ps1 up ; bun run test:e2e:twincat   # expect 90 pass / 0 fail
```

Three runs, all three required: **before the first move** (0.2 — a red baseline invalidates everything after
it), **after the last `Volt.Engine` move**, and **at close-out**. Close-out must match the baseline numbers
exactly, with no test edited.

**The baseline to match (2026-08-05):**

| | |
|---|---|
| CODESYS | **92 pass / 8 skip / 0 fail** |
| TwinCAT | **88 pass / 11 skip / 2 fail** — the 2 are `conflict-resolve`, parked with evidence in `ledger.md` |

The 8 CODESYS skips are **5 real tests + 3 lifecycle hook entries**, from exactly two suites, both skipped by
design: `lifecycle/ide-restart` (TwinCAT-only *and* opt-in via `VOLT_E2E_IDE_CHAOS`) and
`stability/parallel-instances` (needs `VOLT_PIPE_SLOW` **and** `VOLT_PIPE_FAST`). Note the older RUNBOOK claimed
`libcache` was among them — it is not; `libcache` is skipped on **TwinCAT** only and passes on CODESYS.

`libcache` (2 tests) is skipped on TwinCAT **by design** — no signature-extraction surface there. It is a
feature gap, not configuration; do not try to make it run. TwinCAT is best-effort COM: an XAE that is replaced
gets a new pid → new worker → new pipe, and the old worker serves a dead pipe for ~15 s before the connector
reaps it. Re-verify anything conclusive twice.

## 6. State as of this writing

Nothing run. `audit-volt-cli-src` is still in flight — **finish or park it before phase 5 starts**, because a
line-by-line audit and a structural move competing for the same files will conflict, and the audit's ledger
assumes files stay where they are. Phases 1–4 are safe to run alongside it (read-only), and its findings are
input to phase 2.
