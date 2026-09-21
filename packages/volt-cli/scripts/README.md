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
| `ide.ps1` | serve a COPY of a committed fixture over the pipe on EITHER vendor (the IDE writes what it has open, so the copy is the default and `-InPlace` is the opt-out) — `up` / `down` / `pipe` / `logs`, `-Vendor codesys\|twincat`. Builds the bridge first, waits for the pipe with `-Wait`, and prints its name. CODESYS runs the shipped `start_volt_codesys.py` in-proc; TwinCAT gets a `VoltBridgeTwincat --xae-pid` worker, which this spawns so the tier does not depend on the tray. |
| `corpus-migration.ts` | the migration finder: pull a corpus, push it into an empty project, pull again, compare |
| `e2e-graphical-coverage.ts` | which network-text constructs the live suite actually PUSHES — a report, not a gate. 20 of 25 today. |
| `start_volt_codesys.py` | **shipped** — the in-IDE host; CODESYS's own message loop answers the pipe, so the IDE stays clickable |
| `stop_volt_codesys.py` | its counterpart |
| `run_pipe_production.py` | the launcher `ide.ps1` hands to `--runscript` (dialog suppression + a file log) |
| `probe-tc-task.ps1` | a PowerShell probe — TwinCAT is COM, not IronPython |
| `probe-tc-project-object.ps1` | the other one: what `Projects.Item(i).Object` IS, and how to tell a TwinCAT project from a C# one (DIALECT D35) |

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
`probe-nwl-boxoutputs`, `probe-nwl-execute-compare`, `probe-nwl-execute-create`.

**Structure** — `probe-tc-name-collision` (TwinCAT refuses to CREATE a folder whose name an object at that
level already has, in either kind — but the two may COEXIST, so it is an ORDER constraint, DIALECT D34).

**Session** — `probe-tc-project-object` (a solution project is told apart by what it can ANSWER: an unknown member on a COM object comes back null, so only a `LookupTreeItem` call discriminates — DIALECT D35).

**Online / simulation** — `probe-online-state` (a POU runs in simulation and every variable reads back as a typed
string, `INT#5`; the scripting `ScriptOnline` only works INSIDE a running script, so no C# pipe op can use it —
why the transpiler's oracle, `volt-lsp-iec/scripts/record-exec.py`, is a runscript).

**Catalog** — `probe-duplicate-method` (C0582 is UNREACHABLE on SP21: the object tree refuses a second same-named
method at create — "An object with the name '…' already exists within the corresponding namespace" — so the
compiler never sees the repro, through scripting or the bridge).

**Project / settings** — `probe-project-container`, `probe-projectsettings-scope` (the compiler configuration
is a session SERVICE over per-project state, and the read is sound — DIALECT C24, which closed
`project-settings-sync`).

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
