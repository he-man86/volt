# `volt-cli/scripts`

Every file here is run more than once — by a `package.json` script, CI, a `.claude/workflows` prompt, a test, the
installer / build / dev loop, or an OPEN openspec change's unticked task. That is the whole admission rule.

## Probes are single use

A probe is one question put to a live IDE. Once its answer is recorded — a `DIALECT.md` row, a source comment, a
test, an openspec note — the script is legacy and goes, with its `.log`. The citation stays and points at history:
`probe-x.py (deleted; git show <last commit that had it>:packages/volt-cli/scripts/probe-x.py)`.

That rule removed 54 scripts (53 probes and one analysis of their logs) and 44 logs on 2026-10-03 (last commit holding them: `b2496efb4b`). The probes that
remain are named by `bridge-refusal-review`, which is executing, or feed a Repo.Gates gate — see the table.

**No new per-fact probe scripts.** A vendor fact that a new IDE build could change belongs in ONE data-driven,
re-runnable probe — a table of item types × facts diffed against a committed snapshot — designed in openspec
`vendor-fact-probe`. Until it lands, a one-off question may still be a probe here, deleted once its answer is cited.

## Which bridge a script may touch

**Only an `ide.ps1` fixture instance's — the e2e suite's rule, for every script** (2026-10-03). The pipe resolves
through ONE implementation, `../test/e2e/lib/fixture-ide.ts` (unit-tested in `test/unit/fixture-ide.test.ts`; the LSP
recorders import it too, via `volt-lsp-iec/scripts/bridge.ts`): `scriptPipe(vendor)` takes `VOLT_E2E_INSTANCE`
(unset = the default instance) or a `VOLT_PIPE` naming one exact `volt.bridge.<vendor>.<pid>` that an instance
provably owns — `ide.ps1` recorded the process, it opened a copy under that instance's root, and a TwinCAT XAE's
own command line names that copy's `.sln`. Anything else is refused, naming the pipe and its project; so are several
pipes (`-Fixture both`) — a script drives ONE. A PowerShell probe asks the same code through its CLI,
`bun ../test/e2e/lib/fixture-ide.ts <vendor> [instance]` (prints the pipe, or the refusal and exit 1) —
`probe-tc-refusal-measure.ps1` does. The `.ts` probe over the pipe (`probe-member-name-refusal`) resolves through `scriptPipe`;
before this the `.ts` probes took `VOLT_PIPE` unchecked. The IronPython
probes call no pipe: they run INSIDE the CODESYS `ide.ps1 -RunScript` (or a hand-started `--runscript`) launched, and
the few that pair with a `.ts` half SERVE the pipe that half then resolves (`run_pipe_production.py`, as `ide.ps1` does).

## Tooling

| File | Purpose | Run by |
|---|---|---|
| `build-cli.ps1` | publish `volt.exe`, the pipe workers and the connector bundle | `bun run build:package`, root `build-payload.ts` / `build-installer.ts`, `ide.ps1` |
| `ide.ps1` | serve a COPY of a committed fixture over the pipe on EITHER vendor (the IDE writes what it has open, so the copy is the default and `-InPlace` is the opt-out) — `up` / `down` / `pipe` / `logs`, `-Vendor codesys\|twincat`. Builds the bridge first, waits for the pipe with `-Wait`, and prints its name. `up` records what it opened in `<vendor>-ide[-<Instance>].projects` beside its pid file, and `pipe` prints only THIS instance's pipes (it used to print every `volt.bridge.<vendor>.*` on the machine); together they are how the e2e harness proves a pipe is a fixture copy's before touching it (`test/e2e/lib/fixture-ide.ts` — `VOLT_E2E_INSTANCE` names the instance, and any other pipe is refused, 2026-10-03). `-RunScript <probe.py>` (CODESYS) starts the IDE on a probe that runs `run_pipe_production.py` itself and arms its own read timer, so a probe session is still one `ide.ps1` launched, tracks and closes. CODESYS runs the shipped `start_volt_codesys.py` in-proc; TwinCAT gets a `VoltBridgeTwincat --xae-pid` worker, which this spawns so the tier does not depend on the tray. `down` closes only what that `up` (same `-Vendor` and `-Instance`) recorded — the IDEs and workers it started, and a process one of them started — never an IDE another session launched from this checkout; `-DryRun` prints what it would close. Sessions running side by side use distinct `-Instance` names. **No leftovers, no recovery dialog** (2026-10-03): `down` closes an IDE through its own shutdown — TwinCAT by DTE (`Solution.Close(false)` then `Quit`, in a child process so a modal dialog costs a timeout, not a hang), CODESYS by a `quit` request file the harness runscript answers (`projects.primary.close()` without saving, then the main window's normal close) — and forces only after 90 s. `up` first reaps what ITS instance left: an IDE or worker still running (closed the same way), a worker whose XAE is gone, an XAE that Windows' Restart Manager relaunched on this instance's copy (found by command line — no record names it), the XAE recovery entries naming this copy, and the copy itself (`.vs`/`.suo`, `.~u` locks, CODESYS `.opt`). A second `up` on the same `-Instance` therefore replaces the first; use `-Fixture both` or a second instance for two windows. **Where the recovery state lives (measured):** `%APPDATA%\Beckhoff\TcXaeShell\15.0_IsoShell\AutoRecoverDat\<xae pid>.dat` + `.suodat`, written at an autosave tick while the solution has unsaved changes and removed on a clean exit; the `.dat` is UTF-16 naming each dirty file and its backup under `Documents\Visual Studio 2017\Backup Files\<solution name>\~AutoRecover.*`, the `.suodat` the `.sln`. Keyed by PID, so it is cleared by content (only entries naming this copy, never a live XAE's). A hard-killed XAE's entry makes the NEXT XAE opening the SAME `.sln` show "TcXaeShell Recovered Files" (`#32770`, main window disabled — reproduced); an orphan naming a different path showed no dialog (measured). The `~AutoRecover.*` backups are shared by every same-named copy and are left alone — without the `.dat` nothing reads them. CODESYS showed no dialog over a stale `.~u` lock (measured). **Verified live on instance `idefix`, `-Fixture 14`:** crash (dirty project, autosave entry written, XAE Stop-Process -Force, worker left on the dead XAE) → `up`: worker stopped, entry cleared, no dialog, attached in 77 s (baseline 74 s), `health` answers; dirty project → `down`: closed cleanly in 6.5 s, no entry left → `up`: no dialog, 76 s; `up` over a running instance: previous XAE closed cleanly, fresh one attached in 79 s. CODESYS: dirty project (a pushed POU) → `down`: `quit.done`, closed cleanly in 3.3 s, no lock left → `up`: no dialog, serving in 21 s; `up` over a running instance: closed cleanly, serving in 23 s. Not exercised: the 90 s force fallback, and a CODESYS started on a runscript without the quit handler (it gets the main-window close, which prompts if dirty, then the force). **Safety net — the dialog that appears anyway** (2026-10-03): while `up` waits for the worker to attach (no background watcher — the wait loop itself, once a second), it looks at the visible top-level windows OWNED by this instance's XAE pids (the ones it launched, plus an XAE holding this instance's copy) and answers exactly one dialog: class `#32770`, title `TcXaeShell Recovered Files`, a button `&Do Not Recover` — clicked by `BM_CLICK` (Win32 via Add-Type), with ONE line naming the XAE pid, the instance and the files the dialog listed (read from its own list view, columns project / file). Any other modal dialog on those windows is logged once with its title and buttons and left alone — `up` keeps waiting and times out as before; another instance's IDE is never looked at. **Verified live on instance `dlgtest`, `-Fixture 14`:** dirty edit → autosave entry `44208.dat` written → XAE + worker hard-killed → entry restored right after `up`'s clear (the cleanup bypassed by the test, not the script) → `up`: `dismissed 'TcXaeShell Recovered Files' on XAE 27444 (instance dlgtest) with '&Do Not Recover' - files: TwinCAT Project14 / dirty.txt` 3 s after launch, worker attached, `health` answers (`TwinCAT Project14`, healthy), 83 s; a normal `up` logs no dialog line (83 s); a MessageBox titled `TcXaeShell Recovered Files` without that button, and an unrelated one, were logged and NOT clicked. | the dev loop, the e2e suite, `.claude/workflows/execute-change.js` |
| `console.ts` | build the CLI and serve the interface console with the right `dotnet` | `bun run console` |
| `start_volt_codesys.py` | **shipped** — the in-IDE host; CODESYS's own message loop answers the pipe, so the IDE stays clickable | the connector, `ide.ps1`, the installer payload |
| `stop_volt_codesys.py` | its counterpart | the connector, the installer payload |
| `run_pipe_production.py` | the launcher `ide.ps1` hands to `--runscript` (dialog suppression + a file log) | `ide.ps1`, `test/e2e/lib/codesys-native.ts` |
| `corpus-migration.ts` | the migration finder: pull a corpus, push it into an empty project, pull again, compare. Runs its blanks on its OWN `ide.ps1` instance, `corpus-migration`, and takes the pipe from that instance's record (`fixture-ide.ts`) | by hand, after a push/pull change (cited by engine tests and DIALECT rows as the finder of their cases) |
| `refusal-census.ts` | every refusal site in `src` (throw, network-text diagnostic, coded conflict row) as TSV; `--rev <commit>` for an older tree, `--against <commit>` for the sites gone / new / moved since then | openspec `bridge-refusal-review` 6.3; self-check `test/unit/refusal-census.test.ts` |
| `e2e-graphical-coverage.ts` | which network-text constructs the live suite actually PUSHES — a report, not a gate (20 of 25) | by hand, when the graphical e2e tier changes (`test/e2e/graphical/uncovered-shapes.test.ts`) |
| `author-hidden-member-fixture.py` / `-tc.ps1` | AUTHOR `VltFixtureMembers` (an ST FB with a CFC method and an SFC action) into the CODESYS / TwinCAT fixture, by the IDE itself — Volt creates no diagram | whenever a fixture project is regenerated (`test/e2e/README.md`) |
| `voltprobe.py` | the shared helpers every IronPython probe imports (below) | the `.py` probes and `author-hidden-member-fixture.py` |

## Probes that remain

| Files | What it settles | Why it stays |
|---|---|---|
| `probe-member-name-refusal.ts` → `member-name-refusal{,-families,-verify}{,-tc}.log` | both vendors refuse a member or item NAME by the word alone (1475 words as a METHOD, ~220 also as ACTION / PROPERTY / top-level FB, three context controls; `PROBE_SET=verify` re-asks the accepts) | Repo.Gates `RefusedNamesMatchTheLogsTests` reads the six logs: the drivers' `CodesysRefusedNames` / `TcRefusedNames` are their refused words (`VOLT_WRITE_REFUSED_NAMES=1` regenerates); a new IDE build is re-probed with this |
| `probe-identifier-names.py` → `identifier-names.log` | CODESYS refuses every non-identifier name shape for a POU and all five member kinds; a backtick-quoted name builds (DIALECT C28) | `bridge-refusal-review` 3.1 |
| `probe-tc-refusal-measure.ps1 -Phase names\|language\|priority` → `tc-refusal-measure-<phase>.log` | TwinCAT, COM on an `ide.ps1 -Instance bridge-refusal-review` copy: the same name shapes refused (C28); ST over an archive refused, an archive over ST stored as text (N24); every task priority coerced to a UINT16 (C19c) | `bridge-refusal-review` section 3 |
| `probe-wire-type-build.py` → `wire-type-build.log` | a comparison box whose stored output type contradicts it is kept and ignored by the build (N25) | `bridge-refusal-review` 3.2 |
| `probe-body-language-change.py` → `body-language-change.log` | an existing body takes an Implementation aspect of the other language in place, compiles and runs (N24) | `bridge-refusal-review` 3.3 / 3.4 |
| `probe-member-language-change.py` → `member-language-change.log` | the same for members | `bridge-refusal-review` |
| `probe-view-switch.py` → `view-switch.log` (GUI CODESYS, no `--noUI`: the command needs the editor in front) | the vendor's own View command (`ViewAsFBD` / `ViewAsLD`, run through its `ExecuteBatch` on an opened NWL editor) changes `DefaultViewMode` and nothing stored — an LD body with two `PARALLEL`s goes to FBD and back with every network and the language model unchanged, saved, closed and reopened — every node member compared by value, the few it skips checked unserialized and listed at the end of the log; only the unserialized `Ordinary` of an AND/OR box follows the view (DIALECT N23) | `bridge-refusal-review` 3.10 |
| `probe-tc-view-switch.ps1` (+ its bridge half `probe-tc-view-switch.ts`) → `tc-view-switch.log` | TwinCAT, DTE on an `ide.ps1 -Instance bridge-refusal-review -Fixture 14` copy: `FBDLDIL.Viewasfunctionblockdiagram` / `Viewasladderlogic` change exactly one archive line, `DefaultViewMode`; opening the editor alone re-resolves operand types (no pull change); the build after the switches logs every diagnostic and matches a baseline build taken before the probe POUs exist (N23) | `bridge-refusal-review` 3.10 |
| `probe-interface-accessor-write.py` → `interface-accessor-write.log` | an interface accessor's declaration takes the driver's write and has no body slot (D41) | `bridge-refusal-review` 3.6 |
| `measure-library-signatures.ts` + `probe-library-signature-cost.py` → `library-signature-cost-{codesys-fixture,codesys-fixture-settled,codesys-pro2193,codesys-pro2193-settled,twincat-project14,codesys-fixture-step2,twincat-project14-step2}.log` | what a directed `.library` read answers today (the manifest alone), the cost of the signature extraction (cold / warm / after an edit / after Clean, over the pipe; extraction ≈ init − a no-extraction fetch), the message view a read leaves behind, and the raw CODESYS `LibraryPath`s against each ref's RESOLUTION (wildcard refs, paths two refs claim, refs repeating one RESOLUTION, `.library` names a known fetch re-sends). `-settled` runs wait 60 s (`MEASURE_SETTLE_MS`) before the first fetch and repeat Clean twice. The `.py` is the CODESYS `-RunScript` that serves the pipe and answers `messages` / `libpaths` / `edit` / `clean` by request file; TwinCAT runs the `.ts` alone. Since 2.3 it also reads two DIFFERENT libraries directed in a row, each checked against the full fetch, and `MEASURE_PARITY=1` reads every name `refs` publishes on its own and tallies `SAME`/`DIFFERS`/`AMBIGUOUS` per extension (the `-step2` logs are that baseline, for 4.1 / 4.3) | `directed-library-signatures` 1.1 / 1.2 / 1.3 / 2.3 (numbers in its tasks.md) |
| `merged-classes.log` (its probe deleted — `git show b2496efb4b:packages/volt-cli/scripts/probe-merged-classes.py` / `.ts`) | every merged class keeps GUID and CLR class through write / rename / move; lines 112 and 229 show a move into a non-folder node accepted (DIALECT C2n) | open task `bridge-refusal-review` 4.31 cites its lines |

## `voltprobe.py` — the shared half of every probe

Everything a probe needs that is not the question it asks: `bf()`, `unwrap()`, `prop()`, `call()`, `dump()`,
`walk()`, `logger()`, `open_copy()`, `object_manager()`, `projects_from_env()`.

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
```

**It exists because the copies had drifted, and the drift was not cosmetic.** Twelve probes carried these
helpers and `call()` had forked into four versions — one searching `GetMethods()` with no BindingFlags, so it
could see only PUBLIC methods. In a toolkit whose whole job is reading non-public vendor surfaces, that version
answers "no such method" for a method that is right there. **A probe with a wrong helper does not fail; it
reports something untrue**, which is the one thing a probe must never do. The shared version is the union:
`bf()` so non-public members are found, and a reason string so a failure says which kind it was.

Two traps it now absorbs, both of which cost a debugging round:

- `prop()` reads by **reflection first**. IronPython answers *"'ScriptPouObjectList' object has no attribute
  'PouObjectList'"* for a non-public property that the same object's own reflection listing prints one line
  earlier. A probe that only tried `getattr` concluded the field did not exist.
- **An imported module is stricter than the runscript itself.** `start_volt_codesys.py` carries non-ASCII
  characters and runs fine as the `--runscript` target; the same character in `voltprobe.py` is a hard PEP 263
  `SyntaxError` that breaks *every* probe here at once, before any of them can open its log. Hence the encoding
  declaration as well as the ASCII-only rule.

## Running one

```pwsh
$env:VOLT_PROBE_PROJECTS = "C:\...\a.project;C:\...\b.project"   # or VOLT_PROBE_PROJECT for one
$env:VOLT_PROBE_LOG      = "...\scripts\my-probe.log"           # defaults beside the probe
Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
  -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="...\probe-x.py"'
```

`Start-Process -Wait`, not `&` — the call operator returns before the IDE has finished, and the log is then
read while it is still being written.

**A probe opens a COPY** (`vp.open_copy`), never the engineer's file: a scripting open can dirty a project, and
a probe that modifies what it measures has measured nothing.

**Say how far the walk got.** "This project has no ladder" and "the walk broke on the first node" produce the
same empty census, and only one of them is a result. `probe-nwl-coil-modifiers` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-coil-modifiers.py`)
printed its stage counters above its findings for exactly this reason — its first run reported nothing for a project that genuinely has
one graphical POU, and without the counters that would have read as a broken probe.
