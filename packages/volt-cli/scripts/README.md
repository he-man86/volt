# `volt-cli/scripts`

Every file here is run more than once — by a `package.json` script, CI, a `.claude/workflows` prompt, a test, the
installer / build / dev loop, or an OPEN openspec change's unticked task. That is the whole admission rule.

## Probes are single use

A probe is one question put to a live IDE. Once its answer is recorded — a `DIALECT.md` row, a source comment, a
test, an openspec note — the script is legacy and goes, with its `.log`. The citation stays and points at history:
`probe-x.py (deleted; git show <last commit that had it>:packages/volt-cli/scripts/probe-x.py)`.

That rule removed 54 scripts (53 probes and one analysis of their logs) and 44 logs on 2026-10-03 (last commit holding them: `b2496efb4b`). On 2026-10-11 the last ones — `bridge-refusal-review`'s, archived
2026-10-04 — became rows of the vendor-fact table and went with their logs (last commit holding them: `5312b799fe`;
where each fact went is below). **No probe script remains.**

**No new per-fact probe scripts — a new vendor question is a table row, never a new probe script.** A vendor fact
that a new IDE build could change lives in ONE data-driven, re-runnable probe (openspec `vendor-fact-probe`):

```sh
bun scripts/vendor-facts.ts <codesys|twincat> [--write] [--only <fact>,<fact>…]
```

| File | What it is |
|---|---|
| `vendor-facts.table.ts` | the table: one row per fact `DIALECT.md` marks `[PROBE: <id>]`, in a closed step/read vocabulary (Repo.Gates `VendorFactTableMatchesDialectTests` keeps the rows and the markers equal); its `nwl` read is a graphical body flattened from the vendor's own archive in one notation on both vendors, filtered by the runner (`nwlView`; openspec `ld-fbd-coverage` 2.2) |
| `vendor-facts.ts` | the runner: starts its OWN `ide.ps1` instance (`vendor-fact-probe`, or `VOLT_VENDOR_FACTS_INSTANCE` when set — never `VOLT_E2E_INSTANCE`, which names an e2e IDE already up; a copy of a committed fixture; CODESYS on the runscript below and in English, `-CodesysCulture en-US` — the snapshot's language, which a machine whose Windows UI language CODESYS does not ship turns German, DIALECT V9 — TwinCAT `-Fixture 14`), runs each row step by step — `via: "push"` writes and `fetched` reads (the item text `volt pull` writes) over the pipe, everything else in the vendor core — and diffs the sorted snapshot against `vendor-facts.<vendor>.json`, failing on any difference with the fact and both values. `--write` replaces the snapshot (a change to it is a DIALECT finding to record); `--only` runs and writes only the named facts. Every run (an `--only` one too) first reads `ide-identity` and refuses any IDE build but the one the committed snapshot was recorded on, naming both. Self-check `test/unit/vendor-facts.test.ts` |
| `vendor-facts.codesys.py` | the CODESYS core: the `-RunScript` that runs `run_pipe_production.py` verbatim and answers request files on the UI thread |
| `vendor-facts.twincat.ps1` | the TwinCAT core: COM on this instance's XAE (ROT by pid), one JSON line each way |
| `vendor-facts.codesys.json` / `vendor-facts.twincat.json` | the committed snapshots — reviewed like any baseline (recorded by openspec `vendor-fact-probe` 3.1). Their `refused-names` fact is the drivers' refused-word lists: Repo.Gates `RefusedNamesMatchTheSnapshotTests` holds `CodesysRefusedNames` / `TcRefusedNames` / `BothVendorsRefusedNames` to it (`VOLT_WRITE_REFUSED_NAMES=1` regenerates them) |

Adding a fact is one row (and its `[PROBE: <id>]` marker on the DIALECT row it backs); adding an item type is one
row. If a fact does not fit the vocabulary, that is a design finding for the table, not a reason for a script.

## Which bridge a script may touch

**Only an `ide.ps1` fixture instance's — the e2e suite's rule, for every script** (2026-10-03). The pipe resolves
through ONE implementation, `../test/e2e/lib/fixture-ide.ts` (unit-tested in `test/unit/fixture-ide.test.ts`; the LSP
recorders import it too, via `volt-lsp-iec/scripts/bridge.ts`): `scriptPipe(vendor)` takes `VOLT_E2E_INSTANCE`
(unset = the default instance) or a `VOLT_PIPE` naming one exact `volt.bridge.<vendor>.<pid>` that an instance
provably owns — `ide.ps1` recorded the process, it opened a copy under that instance's root, and a TwinCAT XAE's
own command line names that copy's `.sln`. Anything else is refused, naming the pipe and its project; so are several
pipes (`-Fixture both`) — a script drives ONE, and so does the e2e suite. A PowerShell script asks the same code through its CLI,
`bun ../test/e2e/lib/fixture-ide.ts <vendor> [instance]` (prints the pipe, or the refusal and exit 1). `vendor-facts.ts`
resolves through `scriptPipe`; before this the `.ts` probes took `VOLT_PIPE` unchecked. An IronPython runscript calls no
pipe: it runs INSIDE the CODESYS `ide.ps1 -RunScript` (or a hand-started `--runscript`) launched, and the CODESYS
vendor core SERVES the pipe the runner then resolves (`run_pipe_production.py`, as `ide.ps1` does).

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
| `e2e-graphical-coverage.ts` | which network-text constructs the live suite actually PUSHES — a report, not a gate (20 of 25) | by hand, when the graphical e2e tier changes (`test/e2e/graphical/uncovered-shapes.test.ts`) |
| `author-hidden-member-fixture.py` / `-tc.ps1` | AUTHOR `VltFixtureMembers` (an ST FB with a CFC method and an SFC action) into the CODESYS / TwinCAT fixture, by the IDE itself — Volt creates no diagram | whenever a fixture project is regenerated (`test/e2e/README.md`) |
| `author-one-to-one-fixture.py` | AUTHOR the bridge-one-to-one objects into a copy of CodesysTestProject, committed as its own fixture `test/fixtures/CodesysOneToOne.project` (never into CodesysTestProject: it hosts the LSP oracle recorders and the vendor-facts rows), through the vendor's own Add Object path (a check function, a text-list enum, an abstract method, an excluded POU, an ExternalEvent task, a commented call, a standalone transition) — Volt's push makes the plain class, the defect `test/e2e/one-to-one` pins | whenever a fixture project is regenerated (openspec `bridge-one-to-one` 2.2) |
| `author-unicode-members-fixture.py` | AUTHOR `test/fixtures/CodesysUnicodeMembers.3.5.21.40.project` (openspec `codesys-existing-unicode-members` 1.1): Project Settings "Unicode identifiers" switched on and stored as the engine stores it, a CJK-named FB with two CJK methods, a CJK DUT and a task-called program, built clean, by the IDE's own scripting creates; it MEASURES on the way (a CJK create with the option off and on, the identifier shapes with it on) and its log is DIALECT C28b | whenever that fixture is regenerated; read by `test/e2e/items/unicode-members.test.ts` |
| `completeness.ts` (+ `disposition.table.ts`, `completeness.known.ts`) | THE COMPLETENESS ORACLE (openspec `bridge-one-to-one` 2.1): per fixture object of each class, the vendor's OWN archive (the cores' `archive` read) before and after an UPDATE and a CREATE through the shipped bridge, every member judged by the disposition table (spelled / cache / identity / refused / scope / measure); undecided and unreadable members (an unreadable archive or child list included), a refused update and a wire item no known class maps to (`UNCOVERED`) fail by name; a refused create is keyed by its codes AND markers (`[partiallyApplied]` / `[remains]` / `[renamedTo]`) and an object it left behind is judged; `completeness.known.ts` lists the expected failures by member AND kind, each with the SUBJECTS (`<project>/<wire>`) that fail it (a listed subject the run ran that passes fails the run). CODESYS serves `CodesysOneToOne`; the TwinCAT archive reads the file byte-exact (no end-of-line normalization; BOM, declaration and comments as members). Its own instance (`VOLT_VENDOR_FACTS_INSTANCE`), the vendor-facts cores and pipe side; `--only` judges, and `--write-known` rewrites, only the subjects the run ran | by hand, per step of the change; self-check `test/unit/completeness.test.ts` |
| `author-version-fixture.py` | MAKE the fixture NATIVE to each installed CODESYS version, `test/fixtures/CodesysTestProject.<version>.project` (openspec `environment-dependency-audit` 2.5b; owner: one project per version, never one opened from another version's file): `export` in 3.5.21.40 (the source's own version) writes the application as PLCopen XML (declarations as plain text) + its tasks; `import` in each version creates an empty project through that version's scripting, adds that version's own `CODESYS Control Win V3 x64`, imports the XML, builds the tasks member for member, applies the placeholder redirections SP18's import drops, builds (0 messages on all four) and writes an inventory to diff against the source's. What each version holds differently is listed in openspec 2.5b | when a CODESYS version is installed, or the source project changes |
| `record-nwl-corpus.py` | RECORD the NWL corpus (openspec `ld-fbd-coverage` 1b.3): every LD/FBD body of the five CODESYS corpus projects, its WHOLE archive (`GetSerializableValue`, recursively) plus the API answers the reader uses where they differ from it (counted by shape, or listed by path where the archive holds a value), as `test/fixtures/nwl-corpus/<corpus>.nwl.xml` — the input of the NWL completeness oracle (`CodesysNwlCompletenessOracleTests`). One CODESYS (`ide.ps1 -Instance <yours> -RunScript`) opens a copy of each project in turn; the header holds the command line and the file format. The TwinCAT corpus's archives are the `.TcPOU`s, copied into `nwl-corpus/twincat-project14` (gated byte for byte against the fixture); what TwinCAT's native builder makes of them is judged offline (`TcNwlCompletenessOracleTests`) | when a corpus project changes, or the oracle needs a member the recording lacks (openspec `ld-fbd-coverage` 2.2 / 2.3) |
| `record-nwl-live.py` | RECORD what the completeness oracle cannot take from its doubles (gate 1b-3): every NWL object the SHIPPED writer constructs, made in a live CODESYS as it makes it (the bridge's own `NwlInterop.New`), with its whole archive — the fresh values the oracle lays the written doubles over — and every pro2193 network storing a symbol comment as the SHIPPED reader (`CodesysNetworkReader.ReadNetwork`, loaded from `VOLT_BRIDGE_DLL`) reads it, with the shipped rebuild refusal's answer, as `test/fixtures/nwl-corpus/live.codesys.xml`. One CODESYS (`ide.ps1 -Instance <yours> -RunScript`); the header holds the command line | when the writer constructs a new NWL class, the reader's symbol-comment read changes, or a CODESYS version is added |
| `tc-native-corpus.ps1` | RECORD the TwinCAT NATIVE CORPUS (openspec `twincat-inproc-host` 2.2): each `test/fixtures/tc-native-corpus/import/<name>.plcopen.xml` (committed: the FBD shapes lowered by the deleted PLCopen writer, the hand-written TC6 bodies from `TcNativeCorpusTests`) imported into a scratch POU of the XAE behind an `ide.ps1 -Instance`, and the archive TwinCAT serializes for it written beside it as `<name>.nwl.xml` (or the importer's refusal as `<name>.refused.txt`). PLCopen is an authoring tool here only: the recorded archives are TwinCAT's own, the templates the native writer (`TcArchiveBuilder`) is held to and the identity gate sweeps | to re-make the corpus on another TwinCAT version, or when a hand document changes (`VOLT_WRITE_TC_CORPUS=1`) |
| `voltprobe.py` | the shared helpers every IronPython script here imports (below) | `vendor-facts.codesys.py`, `author-hidden-member-fixture.py`, `author-one-to-one-fixture.py`, `author-unicode-members-fixture.py`, `author-version-fixture.py`, `record-nwl-corpus.py`, `record-nwl-live.py` |

## Where the last probes went (2026-10-11, openspec `vendor-fact-probe` 4.1)

| Deleted (`git show 5312b799fe:packages/volt-cli/scripts/<file>`) | Now |
|---|---|
| `probe-member-name-refusal.ts` → `member-name-refusal{,-families,-verify}{,-tc}.log` | row `refused-names` (C28): the 1494 words the logs asked, frozen in the table, each asked as a METHOD and the 216 cross-check words as an ACTION / PROPERTY / top-level FB, through the vendor API; Repo.Gates `RefusedNamesMatchTheSnapshotTests` replaced `RefusedNamesMatchTheLogsTests` |
| `probe-identifier-names.py`, `probe-tc-refusal-measure.ps1 -Phase names` + logs | row `identifier-shapes` (C28) |
| `probe-tc-refusal-measure.ps1 -Phase priority` + log | row `task-priority-range` (C19c) |
| `probe-body-language-change.py`, `probe-member-language-change.py`, `probe-tc-refusal-measure.ps1 -Phase language` + logs | row `body-language-change` (N24) |
| `probe-interface-accessor-write.py` + log | row `interface-accessor-write` (D41) |
| `probe-tc-move-target.ps1` + log, `merged-classes.log` lines 225-229 | row `move-target` (C2q) |
| `probe-move-holders.py` + log | not a row — a census over real projects; its counts stay in DIALECT C2q |
| `probe-view-switch.py`, `probe-tc-view-switch.{ps1,ts}`, `probe-wire-type-build.py` + logs | not rows — they build or open graphical bodies, which the table's vocabulary cannot; N23 and N25 wait with the other N-rows for the LD/FBD design (`vendor-fact-probe` 4.2) |
| `measure-library-signatures.ts`, `probe-library-signature-cost.py` + nine logs | not rows — timings, not facts; the numbers are in openspec `directed-library-signatures` (archived) |
| `merged-classes.log` | its other findings are DIALECT C2n's, which the row `merged-classes` re-measures |

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

## Running an IronPython script by hand

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
