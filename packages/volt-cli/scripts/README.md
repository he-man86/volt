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

## Tooling

| | |
|---|---|
| `build-cli.ps1` | publish `volt.exe`, the pipe workers and the connector bundle |
| `ide.ps1` | serve a COPY of a committed fixture over the pipe on EITHER vendor (the IDE writes what it has open, so the copy is the default and `-InPlace` is the opt-out) — `up` / `down` / `pipe` / `logs`, `-Vendor codesys\|twincat`. Builds the bridge first, waits for the pipe with `-Wait`, and prints its name. `-RunScript <probe.py>` (CODESYS) starts the IDE on a probe that runs `run_pipe_production.py` itself and arms its own read timer, so a probe session is still one `ide.ps1` launched, tracks and closes. CODESYS runs the shipped `start_volt_codesys.py` in-proc; TwinCAT gets a `VoltBridgeTwincat --xae-pid` worker, which this spawns so the tier does not depend on the tray. `down` closes only what that `up` (same `-Vendor` and `-Instance`) recorded — the IDEs and workers it started, and a process one of them started — never an IDE another session launched from this checkout; `-DryRun` prints what it would close. Sessions running side by side use distinct `-Instance` names. |
| `corpus-migration.ts` | the migration finder: pull a corpus, push it into an empty project, pull again, compare |
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
words, not a pre-flight; `member-name-refusal-rule.log`; openspec `push-keeps-what-landed` tasks 3.1 / 3.G).

**Session** — `probe-tc-project-object` (a solution project is told apart by what it can ANSWER: an unknown member on a COM object comes back null, so only a `LookupTreeItem` call discriminates — DIALECT D35).

**IDE identity** — `probe-ide-identity.py` (CODESYS, read-only `--noUI --runscript`, no project: what a running IDE states
about itself — the platform version, `OEMCustomization`, the host exe's version-info and the entry assembly;
`ide-identity.log`, DIALECT V1/V4) and `probe-tc-ide-identity.ps1` (TwinCAT, starts and quits its OWN TcXaeShell: the DTE,
the shell exe's version-info and four TwinCAT-build sources, with no solution and with a fixture copy open; its own
shell is the owner of `DTE.MainWindow.HWnd`, never a process diff; run it from a 32-bit PowerShell (`tc-ide-identity.log`)
AND a 64-bit one (`-Log tc-ide-identity-64.log`) — a 64-bit reader, like the worker, sees 7 of the 32-bit shell's
modules; DIALECT V5). openspec `ide-identity-report` 1.1–1.5.

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
disagrees; the checkbox offset is measured at 125% scaling only; `tc-project-settings.log`, DIALECT D37–D39, openspec `twincat-project-settings` 1.1).

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
