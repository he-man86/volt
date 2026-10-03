# `volt-cli/scripts`

Two kinds of thing live here, and confusing them is how the directory grew to 73 files.

**Tooling** — build, serve an IDE, drive the finder. Referenced from docs and CI, changes with the code.

**Probes** — one-file questions put to a live IDE, each answering ONE vendor fact, with its answer committed
beside it as a `.log`. A probe is not a test and never runs in CI: it is *evidence*, and the fact it
establishes is cited from the source comment or `DIALECT.md` row that depends on it.

## The rule that keeps this directory honest

**A probe earns its place by being CITED.** When a measurement stops being referenced from `src/`, `test/`,
`docs/` or `openspec/`, it is scaffolding from a question already answered — and it goes, with its log.

That rule removed 32 files in one pass: eight `probe-projectsettings*.py` that were the discovery ladder up to
the one the openspec change actually cites, plus eleven orphaned logs whose probes had been deleted long
before. Keeping them cost nothing visible and hid the twenty that matter.

It has since removed four more, and the pattern repeated exactly: `probe-nwl-survey`, `probe-nwl-objectmodel`
and `probe-nwl-construct` were the ladder up to `probe-nwl-census`/`-dump`, and `probe-projectsettings8` the
one up to `-scope`. Each was cited only from a CLOSED, archived change, and the first three never had a
committed `.log` at all — their answers were `.gitignore`d, which is the same as saying they were never
evidence.

**A probe's `.log` is committed with it.** The probe is the question; the log is the answer, and the answer is
what a source comment cites. `AccessorDeclaration.Keep` says "263 accessors hold a bare `VAR`/`END_VAR`" — the
file that makes that checkable rather than a claim is `accessor-census.log`.

## Which bridge a script may touch

**Only an `ide.ps1` fixture instance's — the e2e suite's rule, for every script** (2026-10-03). The pipe resolves
through ONE implementation, `../test/e2e/lib/fixture-ide.ts` (unit-tested in `test/unit/fixture-ide.test.ts`; the LSP
recorders import it too, via `volt-lsp-iec/scripts/bridge.ts`): `scriptPipe(vendor)` takes `VOLT_E2E_INSTANCE`
(unset = the default instance) or a `VOLT_PIPE` naming one exact `volt.bridge.<vendor>.<pid>` that an instance
provably owns — `ide.ps1` recorded the process, it opened a copy under that instance's root, and a TwinCAT XAE's
own command line names that copy's `.sln`. Anything else is refused, naming the pipe and its project; so are several
pipes (`-Fixture both`) — a script drives ONE. A PowerShell probe asks the same code through its CLI,
`bun ../test/e2e/lib/fixture-ide.ts <vendor> [instance]` (prints the pipe, or the refusal and exit 1) —
`probe-tc-refusal-measure.ps1` does. The `.ts` probes over the pipe (`probe-labels-edge-names`,
`probe-member-name-refusal`, `probe-merged-classes`, `probe-tc-function-members`, `probe-tc-graphical-callee-seed`,
`probe-tc-name-collision`) all resolve through `scriptPipe`; before this they took `VOLT_PIPE` unchecked. The IronPython
probes call no pipe: they run INSIDE the CODESYS `ide.ps1 -RunScript` (or a hand-started `--runscript`) launched, and
the few that pair with a `.ts` half SERVE the pipe that half then resolves (`run_pipe_production.py`, as `ide.ps1` does).

## Tooling

| | |
|---|---|
| `build-cli.ps1` | publish `volt.exe`, the pipe workers and the connector bundle |
| `ide.ps1` | serve a COPY of a committed fixture over the pipe on EITHER vendor (the IDE writes what it has open, so the copy is the default and `-InPlace` is the opt-out) — `up` / `down` / `pipe` / `logs`, `-Vendor codesys\|twincat`. Builds the bridge first, waits for the pipe with `-Wait`, and prints its name. `up` records what it opened in `<vendor>-ide[-<Instance>].projects` beside its pid file, and `pipe` prints only THIS instance's pipes (it used to print every `volt.bridge.<vendor>.*` on the machine); together they are how the e2e harness proves a pipe is a fixture copy's before touching it (`test/e2e/lib/fixture-ide.ts` — `VOLT_E2E_INSTANCE` names the instance, and any other pipe is refused, 2026-10-03). `-RunScript <probe.py>` (CODESYS) starts the IDE on a probe that runs `run_pipe_production.py` itself and arms its own read timer, so a probe session is still one `ide.ps1` launched, tracks and closes. CODESYS runs the shipped `start_volt_codesys.py` in-proc; TwinCAT gets a `VoltBridgeTwincat --xae-pid` worker, which this spawns so the tier does not depend on the tray. `down` closes only what that `up` (same `-Vendor` and `-Instance`) recorded — the IDEs and workers it started, and a process one of them started — never an IDE another session launched from this checkout; `-DryRun` prints what it would close. Sessions running side by side use distinct `-Instance` names. **No leftovers, no recovery dialog** (2026-10-03): `down` closes an IDE through its own shutdown — TwinCAT by DTE (`Solution.Close(false)` then `Quit`, in a child process so a modal dialog costs a timeout, not a hang), CODESYS by a `quit` request file the harness runscript answers (`projects.primary.close()` without saving, then the main window's normal close) — and forces only after 90 s. `up` first reaps what ITS instance left: an IDE or worker still running (closed the same way), a worker whose XAE is gone, an XAE that Windows' Restart Manager relaunched on this instance's copy (found by command line — no record names it), the XAE recovery entries naming this copy, and the copy itself (`.vs`/`.suo`, `.~u` locks, CODESYS `.opt`). A second `up` on the same `-Instance` therefore replaces the first; use `-Fixture both` or a second instance for two windows. **Where the recovery state lives (measured):** `%APPDATA%\Beckhoff\TcXaeShell\15.0_IsoShell\AutoRecoverDat\<xae pid>.dat` + `.suodat`, written at an autosave tick while the solution has unsaved changes and removed on a clean exit; the `.dat` is UTF-16 naming each dirty file and its backup under `Documents\Visual Studio 2017\Backup Files\<solution name>\~AutoRecover.*`, the `.suodat` the `.sln`. Keyed by PID, so it is cleared by content (only entries naming this copy, never a live XAE's). A hard-killed XAE's entry makes the NEXT XAE opening the SAME `.sln` show "TcXaeShell Recovered Files" (`#32770`, main window disabled — reproduced); an orphan naming a different path showed no dialog (measured). The `~AutoRecover.*` backups are shared by every same-named copy and are left alone — without the `.dat` nothing reads them. CODESYS showed no dialog over a stale `.~u` lock (measured). **Verified live on instance `idefix`, `-Fixture 14`:** crash (dirty project, autosave entry written, XAE Stop-Process -Force, worker left on the dead XAE) → `up`: worker stopped, entry cleared, no dialog, attached in 77 s (baseline 74 s), `health` answers; dirty project → `down`: closed cleanly in 6.5 s, no entry left → `up`: no dialog, 76 s; `up` over a running instance: previous XAE closed cleanly, fresh one attached in 79 s. CODESYS: dirty project (a pushed POU) → `down`: `quit.done`, closed cleanly in 3.3 s, no lock left → `up`: no dialog, serving in 21 s; `up` over a running instance: closed cleanly, serving in 23 s. Not exercised: the 90 s force fallback, and a CODESYS started on a runscript without the quit handler (it gets the main-window close, which prompts if dirty, then the force). **Safety net — the dialog that appears anyway** (2026-10-03): while `up` waits for the worker to attach (no background watcher — the wait loop itself, once a second), it looks at the visible top-level windows OWNED by this instance's XAE pids (the ones it launched, plus an XAE holding this instance's copy) and answers exactly one dialog: class `#32770`, title `TcXaeShell Recovered Files`, a button `&Do Not Recover` — clicked by `BM_CLICK` (Win32 via Add-Type), with ONE line naming the XAE pid, the instance and the files the dialog listed (read from its own list view, columns project / file). Any other modal dialog on those windows is logged once with its title and buttons and left alone — `up` keeps waiting and times out as before; another instance's IDE is never looked at. **Verified live on instance `dlgtest`, `-Fixture 14`:** dirty edit → autosave entry `44208.dat` written → XAE + worker hard-killed → entry restored right after `up`'s clear (the cleanup bypassed by the test, not the script) → `up`: `dismissed 'TcXaeShell Recovered Files' on XAE 27444 (instance dlgtest) with '&Do Not Recover' - files: TwinCAT Project14 / dirty.txt` 3 s after launch, worker attached, `health` answers (`TwinCAT Project14`, healthy), 83 s; a normal `up` logs no dialog line (83 s); a MessageBox titled `TcXaeShell Recovered Files` without that button, and an unrelated one, were logged and NOT clicked. |
| `corpus-migration.ts` | the migration finder: pull a corpus, push it into an empty project, pull again, compare. Runs its blanks on its OWN `ide.ps1` instance, `corpus-migration` (its `down` used to close the DEFAULT instance), and takes the pipe from that instance's record (`fixture-ide.ts`), not from the launcher's output |
| `refusal-census.ts` | every refusal site in `src` (throw, network-text diagnostic, coded conflict row) as TSV; `--rev <commit>` for an older tree, `--against <commit>` for the sites gone / new / moved to another file since then (openspec `bridge-refusal-review`; self-check `test/unit/refusal-census.test.ts`) |
| `e2e-graphical-coverage.ts` | which network-text constructs the live suite actually PUSHES — a report, not a gate. 20 of 25 today. |
| `start_volt_codesys.py` | **shipped** — the in-IDE host; CODESYS's own message loop answers the pipe, so the IDE stays clickable |
| `stop_volt_codesys.py` | its counterpart |
| `run_pipe_production.py` | the launcher `ide.ps1` hands to `--runscript` (dialog suppression + a file log) |
| `author-hidden-member-fixture.py` / `-tc.ps1` | not probes: they AUTHOR `VltFixtureMembers` (an ST FB with a CFC method and an SFC action) into the CODESYS / TwinCAT fixture, by the IDE itself — Volt creates no diagram. Kept because the fixture must be re-authored if a fixture project is ever regenerated (`test/e2e/README.md`) |
| `probe-tc-task.ps1` | a PowerShell probe — TwinCAT is COM, not IronPython |
| `probe-tc-project-object.ps1` | another: what `Projects.Item(i).Object` IS, and how to tell a TwinCAT project from a C# one (DIALECT D35) |
| `probe-tc-dut-codes.ps1` | and a third, read-only: each DUT's tree code, `.TcDUT` Id and declaration head, run between `volt push`es (DIALECT C2e) |

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

## Probes, by what they settle

Each names the fact it establishes. Follow the citation in the source to see what depends on it.

**Accessors** — `probe-accessor-census` (263 of 464 accessors hold a bare `VAR`/`END_VAR`; 35 distinct values,
so it is stored content and not an API default), `probe-accessor-decl`.

**Tasks** — `probe-task-writable` (every scheduling field is a real setter; `priority` is a STRING),
`probe-task-calllist` (the `pous` view discards mutation — `PerformWithWriteableCopy` is the supported door),
`probe-task-callcomment` (an entry persists exactly `('Name', 'Comment')`), `probe-task-kind`,
`probe-task-create`, `probe-task-config-survives-delete` (the container is localized, and survives its last
task being deleted).

**Networks / NWL** — `probe-nwl-census`, `probe-nwl-dump`,
`probe-nwl-coils` (the `Negation`+`Set` bits are ONE enum, correlated against the vendor's own PLCopen export),
`probe-nwl-coil-modifiers` (576 assignment targets across five real projects: no edge or negated coil occurs),
`probe-nwl-boxoutputs`, `probe-nwl-execute-compare`, `probe-nwl-execute-create`,
`probe-nwl-census-v2` (the network text v2 census, openspec `network-text-literal-nwl` section 1; `nwl-census-v2.log`
holds the five projects' runs),
`probe-nwl-slots` (a consumer reads the main output — each NWL box paired with its PLCopen export block and every
connection compared — and that is ENO only when the box HAS one, DIALECT N16),
`probe-edge-names-order` (the vendor negates before the edge, on an operand and a box; a Parallel and a wire reference
hold no flag and a new Parallel is `Sequential`; `R_EDGE`/`F_EDGE` are legal POU names, N17/N18/N20),
`probe-nwl-labels` + `probe-labels-edge-names.ts` (labels and jumps built on both vendors — held, and what the
build says, N19; the `.ts` is the TwinCAT half, over the pipe), `probe-st-chained-set` (`a := b S= c;` is legal ST),
`probe-nwl-oracle-rungs` (the seven lenze-mid rungs the v2 ladder oracle pins, dumped fact by fact — which item is a
Parallel, which box has an ENO output, which slot a pin is on; `nwl-oracle-rungs.log`, task 2.4),
`probe-nwl-eno-build` (a box VOLT builds is read through ENO exactly when it has EN, whatever output list Volt writes,
and a consumed enabled comparison does not compile — built and run in simulation, N21, task 4.1).
`voltprobe.build_messages` / `nwl_new` / `nwl_edit` are the build-and-construct half those share.

**DUTs** — `probe-dut-subtype-in-place` (CODESYS: a DUT created as a Structure takes an enum/union/alias declaration in place, same
`guid`, and compiles as the new shape — a build with a negative control, `dut-subtype-in-place.log`; written through scripting),
`probe-dut-subtype-push` (CODESYS, the BRIDGE path: the `--runscript` of a normal GUI IDE that serves the pipe exactly as `ide.ps1`
does and leaves a UI timer answering read requests, so `volt push`es can be made from outside and each object's `guid`, folder,
interfaces and Interface aspect read between them — `dut-subtype-push.log`, including a real text-list enum), `probe-tc-dut-codes.ps1`
(TwinCAT, read-only: each DUT's tree code, `.TcDUT` Id and declaration head; the code keeps its old value after an in-place subtype
change, and re-derives on reload; a DUT created by push is 606 whatever its body in the live session, its reload unmeasured — `tc-dut-codes.log`). All
DIALECT C2e.

**Merged classes** — `probe-merged-classes.py` + `.ts` (CODESYS, the BRIDGE path like `probe-dut-subtype-push`: the `.py` is the
`--runscript` read timer, the `.ts` pushes over the pipe and asks for a read after every step — the text written in place, a rename,
a rename back + a move, the move home — of a check function, a persistent list, a text-list enum, an NVL and an abstract method; every
one keeps its GUID and CLR class, and the delete+set batch that lost them before 5.Qb is in the transcript — `merged-classes.log`,
DIALECT C2n).

**Structure** — `probe-tc-name-collision` (TwinCAT refuses to CREATE a folder whose name an object at that
level already has, in either kind — but the two may COEXIST, so it is an ORDER constraint, DIALECT D34).
`probe-member-name-refusal` (both vendors refuse a member or item NAME — `METHOD Log` — by the word alone: 1475 words
as a METHOD, ~220 also as ACTION / PROPERTY / top-level FB, plus three context controls; every accept READ BACK, and
`PROBE_SET=verify` re-asks the earlier accepts, `<T>_TO_<T>` and lower / mixed case; `member-name-refusal*.log`)
and `member-name-refusal-rule.ts` (one rule on the word describes all 5066 IDE verdicts — a description of the measured
words, not a pre-flight; `member-name-refusal-rule.log`; openspec `push-keeps-what-landed` tasks 3.1 / 3.G). The drivers' pre-flight word lists (`CodesysRefusedNames` / `TcRefusedNames`) are those logs' refused words, held to them by Repo.Gates `RefusedNamesMatchTheLogsTests` (`VOLT_WRITE_REFUSED_NAMES=1` regenerates).

**Refusals measured (openspec `bridge-refusal-review` section 3)** — `probe-identifier-names.py` (CODESYS, `--noUI
--runscript` on a fixture copy: every non-identifier name shape is refused for a POU and all five member kinds with the
word refusal's sentence, and a backtick-quoted name is created and builds — `identifier-names.log`, DIALECT C28, 3.1);
`probe-wire-type-build.py` (a comparison box whose stored output type contradicts it: kept, and ignored by the build —
built and run in simulation, `wire-type-build.log`, N25, 3.2); `probe-body-language-change.py` (an existing body takes an
Implementation aspect of the other language in place, compiles and runs — `body-language-change.log`, N24, 3.3/3.4);
`probe-interface-accessor-write.py` (an interface accessor's declaration takes the driver's write and the build judges
it; it has no body slot — `interface-accessor-write.log`, D41, 3.6); `probe-tc-refusal-measure.ps1 -Phase
names|language|priority` (TwinCAT, COM on an `ide.ps1 -Instance bridge-refusal-review` copy, its DTE taken from the ROT by
that XAE's pid: the same name shapes, all refused (C28); ST over an archive refused and an archive over ST stored as text
(N24); every task priority coerced to a UINT16 without a word (C19c) — `tc-refusal-measure-<phase>.log`; the language
phase builds through the bridge's own `build` op).

**Session** — `probe-tc-project-object` (a solution project is told apart by what it can ANSWER: an unknown member on a COM object comes back null, so only a `LookupTreeItem` call discriminates — DIALECT D35).

**IDE identity** — `probe-ide-identity.py` (CODESYS, read-only `--noUI --runscript`, no project: what a running IDE states
about itself — the platform version, `OEMCustomization`, the host exe's version-info and the entry assembly;
`ide-identity.log`, DIALECT V1/V4) and `probe-tc-ide-identity.ps1` (TwinCAT, starts and quits its OWN TcXaeShell: the DTE,
the shell exe's version-info and four TwinCAT-build sources, with no solution and with a fixture copy open; its own
shell is the owner of `DTE.MainWindow.HWnd`, never a process diff; run it from a 32-bit PowerShell (`tc-ide-identity.log`)
AND a 64-bit one (`-Log tc-ide-identity-64.log`) — a 64-bit reader, like the worker, sees 7 of the 32-bit shell's
modules; DIALECT V5). openspec `ide-identity-report` 1.1–1.5.

**Bridge bundles** — `probe-bridge-bundles.cs` (OFFLINE, no IDE; a .NET 10 file-based app:
`dotnet run scripts/probe-bridge-bundles.cs -- <bundle.zip|dir>...`): per shipped bridge bundle, every Volt and
framework assembly's assembly/file/product version and MVID, which `System.Text.Json` each Volt assembly references
against the one shipped, where `PipeClient.Call` / `WireJson.Write` are defined and called, and a cross matrix of
unresolved type + member references if one bundle's Volt assemblies bound another's (every Volt build is `1.0.0.0`, so the
first copy loaded wins). Types are compared by assembly IDENTITY, as the CLR binds them. `bridge-bundles.log`;
openspec `ide-identity-report` 3.1 / 3.2.

**Online / simulation** — `probe-online-state` (a POU runs in simulation and every variable reads back as a typed
string, `INT#5`; the scripting `ScriptOnline` only works INSIDE a running script, so no C# pipe op can use it —
why the transpiler's oracle, `volt-lsp-iec/scripts/record-exec.py`, is a runscript).

**Catalog** — `probe-duplicate-method` (C0582 is UNREACHABLE on SP21: the object tree refuses a second same-named
method at create — "An object with the name '…' already exists within the corresponding namespace" — so the
compiler never sees the repro, through scripting or the bridge).

**Build diagnostics** — `probe-diagnostic-child-guid` (CODESYS, a `--runscript` launched through `ide.ps1 up -RunScript`
that serves the pipe afterwards: a build error inside a method, property accessor or action carries the CHILD's own
`ObjectGuid`; `PositionOffset` is the 0-based column, `Length` the token's, and `Position` is opaque — not a line,
not an offset; `diagnostic-child-guid.log`, DIALECT C27).

**Project / settings** — `probe-project-container`, `probe-projectsettings-scope` (the compiler configuration
is a session SERVICE over per-project state, and the read is sound — DIALECT C24, which closed
`project-settings-sync`). `probe-tc-project-settings` (read-only: TwinCAT's compiler settings as the automation interface
answers them, LIVE, and as the `.plcproj` stores them, SAVED) with `probe-tc-project-settings-gui` (sets
warnings to `-State Disabled|Enabled` on the Compiler Warnings page — the warning list has no automation surface, so
a real click is the only writer; that click is a blind toggle, so the script reads the saved `.plcproj` before,
refuses a warning already in the requested state, and fails by name when the file read back after Save All
disagrees; the checkbox offset is measured at 125% scaling only, and since 3.3 it expands Solution Explorer's `PLC` node first; `tc-project-settings.log`, DIALECT D37–D39, openspec `twincat-project-settings` 1.1). `probe-codesys-compile-options.py` (a `-RunScript` for `ide.ps1 up -Vendor codesys`: sets CODESYS's `CompileOptions` — the object the descriptor reads — from a request file) and `probe-tc-compile-options.ps1` (the same three options on TwinCAT, by ConsumeXml): the limit, defines and Replace-constants rows measured to agree byte for byte (`codesys-compile-options.log`, `compile-options.log`, DIALECT D38, openspec `twincat-project-settings` 3.4).

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
same empty census, and only one of them is a result. `probe-nwl-coil-modifiers` prints its stage counters
above its findings for exactly this reason — its first run reported nothing for a project that genuinely has
one graphical POU, and without the counters that would have read as a broken probe.
