## Design gate: row shape, vendor core, `[PROBE: id]` marker

**Target.** Each fact the proposal lists becomes one table row. Neither the TS driver nor a vendor core gets a
fact-specific branch.

**Choice: a row is a scenario plus reads, written in a small fixed vocabulary that each vendor core implements once.**

```ts
type Row = {
  id: string                    // kebab, = the [PROBE: id] marker
  dialect: string[]             // DIALECT ids it backs: ["C2e"]
  vendors: { codesys?: true | { absent: string }, twincat?: true | { absent: string } }  // absent = refused by name
  steps: Step[]                 // the closed step set below
  reads: Read[]                 // after a named step: { at: stepIndex, key, op, args }
}
// A Step or Read may carry `vendor: "codesys" | "twincat"`: the same question asked of a different surface
// (C2g reads CODESYS's language model, C2h TwinCAT's caption). That is row DATA, not a branch in a core.
//
// Step ops (closed set):
//   subject  create{kind,name,parent,text?}
//            find{name}   an EXISTING object of the open project. What no create can make is found, never
//                         synthesized (C2n: `create_persistentvariables` / `create_nvl` do not exist on the scripting
//                         container, and `IQSlices` is IDE-authored).
//   write    setText  rename  move  delete   — each names its PATH, `via: "push" | "script"`, with NO default:
//            push   = one declarative op over the instance's pipe through the SHIPPED bridge (refs, then push with
//                     ifVersion: what `volt push` sends);
//            script = the vendor API (CODESYS scripting, TwinCAT COM).
//            A write without `via` is a table error. The DIALECT rows differ on exactly this: C2e is "through the
//            bridge unless noted", C2n, C2m and C2k's TwinCAT half are "through the shipped push", and C2j, C2l and
//            C33 are scripting. A row re-measures the surface its DIALECT row measured.
//   project  open{fixture}  a fresh COPY of a COMMITTED fixture becomes the open project (cleanup reopens the run's
//                           own copy);   close   no project open
//   other    build   reload (save, close, reopen the same copy)
//            invoke{path,args}  a reflection / COM member call, e.g. the task config's PerformWithWriteableCopy
// Read ops (closed set):
//   outcome          accepted | refused + the message verbatim
//   member{path}     reflection / COM read, null = absent
//   class  guid  parent  children  signature
//   parse{text?}     the vendor's OWN parser on the subject's text or a given text (CODESYS
//                    `CreateParser(CreateScanner(text)).ParseInterface().POUType`), null = None
//   xml{xpath}       TwinCAT `ProduceXml` of the subject, at an XPath
//   same{path, as}   reference identity with an earlier read's object: true/false, never a hash or an address
//   diagnostics{guid,position}   process{exe|assembly|automation}
```

**Vendor core interface** (the same in both): `create(row) -> handles` runs the steps and records each step's
outcome; `read(handles, read) -> JSON`; `cleanup(handles)` deletes what was created and, after an `open`, reopens the
run's own fixture copy, whether or not the reads passed. Each vendor run is ONE IDE session on its own instance
(`ide.ps1 up -Instance vendor-fact-probe`). That session serves the PIPE the way a user's does, because `via: "push"`
steps go through it:

- **CODESYS.** `vendor-facts.codesys.py` runs `run_pipe_production.py` verbatim: the fixture copy plus the shipped
  `start_volt_codesys.py`, so the pipe is the shipped bridge. It then arms a UI-thread timer that answers the driver's
  request file with the `script` steps and the reads. This is the shape `probe-merged-classes.py` + `.ts` measured
  C2n with. The driver sends `push` steps over the pipe between requests. It is started through `ide.ps1 -RunScript`.
  The in-proc host serves `projects.primary` live (`CodesysDriver.SnapshotHealth`), so after an `open` the pipe serves
  the opened copy.
- **TwinCAT.** `ide.ps1 up -Vendor twincat -Fixture 14` spawns the shipped `VoltBridgeTwincat` worker, which is the
  pipe. `vendor-facts.twincat.ps1` runs the `script` steps and the reads by COM on the same instance's XAE.

The driver passes all rows in one JSON file and gets one JSON result back, so there is one IDE session per vendor.

**Every listed fact fits.**
- Kind source and C2g/C2h are `create`/`find` + `setText`/`build`/`reload`, then `member`/`class`/`signature`.
- C2j adds `parse`.
- C2k and the duplicate method are `create` → `outcome`.
- C2e is `setText` (push and script) → `guid`/`class`/`parent`/`diagnostics`.
- C2n is `open` + `find` → `setText`/`rename`/`move` (push) → `guid`/`class`.
- D34 and empty folders are `create`/`delete` → `outcome`/`children`.
- The tasks group (C19b, KindOfTask, call list, call comment) is `invoke` → `member`. C19b adds `xml`.
- Accessors use `member`.
- The project container and D35 use `member`/`class`. C24 is `open`/`close` → `member`/`same`.
- D37–D39 use `member`, where a null answer records the ABSENCE.
- C27 is `build` → `diagnostics`.
- V1/V4/V5 use `process`.

**Rejected:**
- *One named reader function per fact.* That is the 54 deleted probes again, kept in one file.
- *A bridge op per fact.* It adds dev-only words to the wire. The facts also sit below the seam, in reflection,
  session services and assembly versions, where the wire cannot reach.
- *Run everything over the pipe.* For the same reason, the pipe sees only what the driver already exposes. The pipe
  carries the WRITES a DIALECT row measured through the bridge (`via: "push"`). It never carries a read.
- *A `fixture` field per row.* A row may ask both vendors, and a vendor run is one session. A row that needs another
  project says so as a step (`open{fixture}`), and only a COMMITTED fixture can be opened.

**Refused by name (in the table as `absent`, or out of it):**
- The TwinCAT warning list stays out of the table. The `probe-tc-project-settings-gui.ps1` GUI half is not
  re-measurable headless, so the row records the automation absence instead.
- Corpus censuses (`accessor-census`, C2j's 262 / 262 over Pro2193, C2n's per-corpus class counts) are not vendor
  facts. The rows re-measure the behaviour, not the count.
- C2n's NVL (`CAN_TO_PLC`) is out. Its only source is Bakon Nano, which is not a committed fixture, and `create_nvl`
  does not exist on the scripting container. The row records the NVL as `absent: no committed fixture holds an NVL`.
- N-rows wait for the LD/FBD design.

A fact one vendor lacks is `{ absent: "<reason>" }` and lands in the snapshot as `"absent: <reason>"`, never a guess.

**Snapshot.** `{ "<fact-id>": { "<read key>": value } }` with sorted keys and no timestamps, pids or object addresses.
Process facts keep versions, since a version change IS a finding.

**Marker.** It goes in the row's id cell, after the bold id: `| **C2e** [PROBE: dut-subtype-in-place] | …`. A row may
carry several. The spelling follows the existing `[RETRACTED -> X]` marker. The gate's regex is
`\[PROBE: ([a-z0-9-]+)\]`. Both directions are checked: marker → row, and row.dialect → an existing id.

**Migration.** 0.2 marks the rows. 1.1 adds the gate, red. 2.x recovers each probe's logic from `b2496efb4b` as a
row. 4.1: after bridge-refusal-review, `RefusedNamesMatchTheLogsTests` reads the refused words from the CODESYS and
TwinCAT snapshots (a `refused-names` row with one `outcome` read per word), and the six logs and
`probe-member-name-refusal.ts` are deleted.

### 0.1 — every listed fact, as one row

Vendors: `C` CODESYS, `T` TwinCAT. A vendor left out is not asked, because the DIALECT row is about the other one.
A row runs on the vendor run's own fixture copy (CODESYS `CodesysTestProject`, TwinCAT Project14) unless it opens
another COMMITTED fixture (`Pro2193` = `Pro2193-94-95-96_COdesys.project`). `push`/`script` is the write path.

| fact id | DIALECT | vendors | steps → reads |
|---|---|---|---|
| `dut-subtype-in-place` | C2e | C T | C: create DUT (struct, in a folder) → setText enum/union/alias `script`, and → enum/union/alias `push` (each outcome recorded: the push to union/alias is unmeasured in C2e); open Pro2193, find `IQSlices` (text-list enum) → setText struct/union/alias `push`. T: create 606 → setText 605/607/623 content `push`; find `E_PackML_Mode` (IDE-authored 605) → setText struct/union `push`; create each subtype `push` → reload. Reads after each step: `guid`, `class`, `parent` (folder kept), `member{ItemType}` (T, lags until reload), `member{interface}` (C, `ITextListEnumerationObject` kept); `build` with a user of the NEW shape and a negative-control user → `diagnostics` (compiles / refused verbatim) |
| `kind-source` | C2e C2g C2h | C T | create POU/DUT `script` → setText `script` → build → reload; C also open Pro2193, find `IQSlices`. C: `member` on object, meta object, icon, language model; T: `member` on tree item, caption |
| `kind-audit` | C2f C2l | C T | create POU + one member of each kind `script` → setText another POU kind (C `script`, T `push`); `class` per object; T: `member{ItemType}` |
| `pou-kind-signature` | C2j | C | create PRG/FB/FUN, and one FB with `exclude_from_build` `script` → build; `signature` and `parse` of each (agree; the excluded one has no signature); `parse{text}` of an unclosed comment, an empty text and prose (`None`) |
| `pou-members-follow-text` | C2k | C T | create POU → setText (FUNCTION) → create METHOD/PROPERTY/ACTION (C `script`, T `push`); `outcome` verbatim; then setText back, `children` |
| `graphical-callee-seed` | C2m | T | create PROGRAM, FUNCTION, FB → create LD body calling each, all `push` → build; `outcome` (box ENO refusal verbatim), `diagnostics` |
| `merged-classes` | C2n | C | open Pro2193; find `CheckBounds`, `PersistentVars`, `IQSlices`, the abstract `TakePicture` (through `VisionSystem_BaseFB`) → setText, rename `VltR_*`, rename back + move, move home + original text, all `push`; `guid`, `class`, `member{KindOfCheckFunction}` after each. NVL: `absent` (see above) |
| `folder-name-collision` | D34 | T | create folder then object of that name; create object then folder of that name, `script`; `outcome` each |
| `empty-folder-survives` | C29 | C T | create folder + POU → delete POU, `script`; `children`; delete folder; `outcome` |
| `task-config-survives-delete` | C22 | C | delete every task `script`; `children` of the task configuration, `class` |
| `task-writable` | C19 | C | invoke each scheduling setter (string and int `priority`); `outcome`, `member` read-back |
| `task-calllist` | C19 | C | invoke `pous.remove(name)`, `remove(0)`, `add`; then `PerformWithWriteableCopy`; `member{pous}` after each |
| `task-callcomment` | C23 | C | invoke `PouObject.SerializableValueNames`; `member` |
| `task-kind` | C30 | C | invoke `kind_of_task` set with a string, int 1, int 0, the enum; `outcome` verbatim and `member` read-back each; `member{enum values}` |
| `task-create` | C31 | C | invoke `create_task(name)` on the task configuration facet → delete; `outcome`, `children` |
| `tc-task-items` | C19b | T | create the PLC task half alone `script` → `outcome` (the system-item-first order, refusal verbatim); create system item then PLC item; set cycle 10 ms; `member{ItemType}` of both items, `children`; `xml` of `TIRT^<task>` `TaskDef/CycleTime` (100 ns ticks) and `TcModuleInstance/Context` cycle (ns), and `PlcTask.TcTTO` `CycleTime` (µs); set a priority another task holds → `xml` read-back (not refused, not taken) |
| `accessor-decl` | C32 | C | create FB + PROPERTY (GET, SET); `member{declaration}` of each accessor |
| `project-container` | C17 | C | `class` of the scripting project, root and application containers |
| `tc-project-object` | D35 | T | `member{Kind, FullName, unknown member}` of each solution project |
| `projectsettings-scope` | C24 | C | open Pro2193 → `member{C0371 disabled, UTF-8}`; close → the same reads (no project: null/defaults); open CodesysTestProject → the same reads; open Pro2193 → the same reads; `class` of the configuration service and `same` (one instance) at every stage |
| `compile-options` | D38 | C T | `member` of replace-constants, max-warnings, defines (live) |
| `tc-project-settings` | D37 D39 | T | `member` of the warning list on the automation interface (null records the ABSENCE) |
| `ide-identity` | V1 V4 V5 | C T | `process{exe, assembly, automation}` |
| `diagnostic-child-guid` | C27 | C | create FB + METHOD with a build error → build; `diagnostics{guid,position}` |
| `duplicate-method` | C33 | C | create FB `script` → create METHOD `Compute` → create METHOD `Compute` again; `outcome` verbatim of BOTH creates (C33 keeps no log that tells the first refused from the second) |

25 facts, 29 marked DIALECT rows. No row needs its own code path: each line is subject steps, write/project/other
steps, and reads from the closed sets.

### What the gate changed, and why

- **The row has no `fixture` field; a row that needs another project opens it as a step.** The review found two facts
  that no single fixture copy could hold: C2n's classes cannot be created (`create_persistentvariables` /
  `create_nvl` are not on the scripting container, `IQSlices` is IDE-authored), and C24 is a SWITCH between two
  projects. So the step set gained `find` (an existing object), `open{fixture}` (a committed fixture's copy) and
  `close`. The vendor run still owns ONE session.
- **Every write names its path, `via: "push" | "script"`, with no default.** C2e, C2n, C2m and C2k's TwinCAT half were
  measured through the shipped bridge, and C2j, C2l and C33 through scripting. A row that re-measured a different
  surface would stay green while the push path changed. So each vendor session serves the shipped pipe: CODESYS's core
  wraps `run_pipe_production.py`, and TwinCAT's is COM beside the shipped worker.
- **Three rows read their whole fact.** C2j gained `parse` (the vendor parser, and `None` for the three broken
  texts). C19b gained `xml` (the schedule in three units: the trap), the system-item-first create and the priority
  uniqueness. C2e gained the text-list enum half, the folder (`parent`) and the build with a negative control.
- **A Step or Read may name its vendor.** Without it the `kind-source` row (C2g reads CODESYS's language model, C2h
  TwinCAT's caption) would need two rows for one question, or a branch in a core.
- **Five listed facts had no DIALECT row** (they lived only in doc-comments): `empty-folder-survives` (probe
  `probe-empty-folder-lifecycle.py`), `task-kind`, `task-create`, `accessor-decl`, `duplicate-method`. A table row
  must cite an existing DIALECT row, so 0.2 filed them as **C29–C33**, copied from the probe logs and the comments that
  cited them. C33's refusal message has no kept log (it is quoted from a `messages.ts` doc-comment), and C30's int was
  tried only as 1. Both rows now say so, so the first probe run settles them rather than inheriting them as baselines.
- **`probe-tc-graphical-callee-seed` backs C2m, not C2f/C2h** as the proposal listed: DIALECT cites that probe and its
  log in C2m only. The marker sits on C2m.
- **`scripts/check-wiring.ts`'s row parser accepted only `| **id** |`**, so a marker in the id cell dropped the row
  and every citation of it would have failed `bun run check`. The parser now allows `[PROBE: …]` markers after the
  id. The 1.1 gate parses `V` and `N` ids as well; check-wiring parses only `A`–`D`.
- **Not marked yet:** the fold-in rows (C28, C19c, D41, N24, N25 — `bridge-refusal-review`'s kept probes, task 4.1)
  and the deferred N-rows (4.2). C2i (touching a declaration-less POU after load crashes XAE) is not re-measured: a
  probe that crashes its IDE is not a re-runnable fact.

## 1.1 — `VendorFactTableMatchesDialectTests` (offline gate)

**Target.** Repo.Gates proves the table and DIALECT name the same facts, offline, in the `volt-cli` CI job.

**Choice: compare PAIR SETS, read both files as text.** The gate builds `{(dialectId, factId)}` twice and asserts the
two sets are EQUAL, reporting each side's extras by name:
- from `DIALECT.md`: every row `| **<id>** [PROBE: a] [PROBE: b] |` (ids `[A-DNV]\d+[a-z]?`, the 0.2 spelling) gives
  `(id, a)`, `(id, b)`;
- from `scripts/vendor-facts.table.ts`: every row's `id: "<fact>"` and its `dialect: ["C2e", …]` give `(C2e, fact)`.

Equality is stronger than the two directions 0.1 named (marker → row, row.dialect → existing id): it also refuses a row
citing a DIALECT row that does not carry its marker. Measured 2026-10-11: today's 31 markers on 29 rows ARE exactly the
31 citations of the 0.1 table (C19 holds two facts, C2e two; `kind-source` cites three rows, `ide-identity` three,
`tc-project-settings` two), so nothing has to move.
Three more asserts, each named: table ids are unique; a cited DIALECT id exists; a marker never sits on a retracted
(`~~id~~`) row — a withdrawn fact is not re-measurable.

**Reading the table: a strict text parse.** The table keeps one literal shape per row — `id: "<kebab>"` and
`dialect: [<"Id">, …]` on the row's own lines, no computed ids, no spreads. The gate counts row openers (`id:`) and
fails, naming the row, when a row lacks a parseable `dialect:` or the counts differ. That is the fail-loud guard
against a table edit the parse would silently skip. Rejected:
- *Spawn `bun` to import the table and print JSON* — no Repo.Gate starts a process; it ties `dotnet test` to bun.
- *A `.json` table* — loses the typed `Step`/`Read` vocabulary 0.1 rests on (a table error becomes a runtime one).
- *Put the check in `check-wiring.ts`* — the task names Repo.Gates, and check-wiring parses only `A`–`D` ids.

**Refused by name.** A missing `vendor-facts.table.ts` fails as `vendor-facts.table.ts not found (task 2.1)` — the gate
is red from 1.1 until 2.1, as tasks.md says, and is not skipped. The fold-in rows (C28, C19c, D41, N24, N25) and the
deferred N-rows carry no marker, so the gate asks nothing of them until 4.1 / 4.2 mark them.

**Migration.** 1.1 commits the test (red, one reason). 2.1 writes the table in the shape above → green. 4.1 adds the
`refused-names` row and its markers in one commit, so the sets stay equal at every commit after 2.1.

## 2 — Build: table, cores, runner, README

**Target.** `bun scripts/vendor-facts.ts <codesys|twincat> [--write]` runs every row of the 0.1 table in one IDE
session on instance `vendor-fact-probe` and diffs the snapshot against `scripts/vendor-facts.<vendor>.json`.

**Choice: the runner drives each row ONE STEP AT A TIME; `via: "push"` steps run in the runner, everything else in a
long-lived vendor core reached by one request/answer protocol.** 0.1 said "all rows in one JSON file, one result back";
that cannot hold, because a row interleaves `script` and `push` steps (C2e, C2n) and a push must reach the pipe BETWEEN
two core steps. So:
- **Table** (`vendor-facts.table.ts`, 2.1): `export const rows: Row[]` with the 0.1 `Row`/`Step`/`Read` types in the same
  file, one literal per row in the strict shape 1.1 parses. The 25 rows are recovered from `b2496efb4b`'s probes.
- **Runner** (`vendor-facts.ts`, 2.3): owns the session — `ide.ps1 up -Vendor <v> -Instance vendor-fact-probe -Wait`
  (CODESYS `-RunScript vendor-facts.codesys.py`, TwinCAT `-Fixture 14`), `down` in `finally`; the pipe through
  `scriptPipe` (`fixture-ide.ts`), so no other IDE is touched. Per row: each step in order (`push` via
  `test/e2e/lib/workspace.ts` `pushOps`, vendor-blind; the rest to the core), each read after its `at` step, then
  `cleanup`. A vendor the row marks `absent` writes `"absent: <reason>"` and asks nothing.
- **Core interface** (TS, the same for both): `step(row, i)`, `read(row, r)`, `cleanup(row)`, each one JSON request →
  one JSON answer with a per-op timeout (60 s; `build`/`open`/`reload` 300 s). The core holds the row's handles by
  `(row id, step index)` and re-resolves them by guid after `open`/`reload`.
  - **CODESYS** (`vendor-facts.codesys.py`, IronPython 2.7, ASCII, on `voltprobe.py`): runs `run_pipe_production.py`
    verbatim, then a UI-thread timer answers `request` files under `%LOCALAPPDATA%\volt-bridge\vendor-facts\<pid>\`
    (`<id>.out` + `<id>.done`, or `<id>.error`) — the `probe-library-signature-cost.py` protocol, already measured.
  - **TwinCAT** (`vendor-facts.twincat.ps1`): ONE PowerShell process for the session, DTE from the ROT by this
    instance's XAE pid (`probe-tc-refusal-measure.ps1`'s lookup), one JSON request per stdin line, one answer per
    stdout line.
- **Outcomes vs errors.** Every step records `accepted | refused: <verbatim>` (that IS data). A READ that throws, or a
  request past its timeout, aborts the run naming fact, step/read and the message — a probe bug is never a value.
- **Snapshot/diff**: keys sorted at every level, no timestamps/pids/addresses; the diff lists every differing path as
  `<fact>.<key>: committed <a> / measured <b>` and exits 1; `--write` replaces the file and prints the same list.
- **README** (2.4): the one command, and "a new vendor question is a table row — never a new probe script".

**Rejected:** *whole-batch file* — breaks the push interleave (above); *the core pushes itself* — the CODESYS core runs
on the UI thread that serves the pipe, so a pipe call from it deadlocks; *a PowerShell spawn per TwinCAT step* — DTE
lookup + `Add-Type` per spawn × ~300 steps; *a bridge op for reads* — refused in 0.1; *the user runs `ide.ps1 up`
first* — two commands, and a CODESYS without `-RunScript vendor-facts.codesys.py` answers no request.

**Refused by name:** the NVL (`absent`), the TwinCAT warning list's GUI half, corpus censuses, N-rows (4.2), the
fold-in probes (4.1). No default `via`, no default timeout-retry, no guessed value for a missing member (`null` = absent).

**Migration.** 2.1 table → the 1.1 gate goes green. 2.2 both cores. 2.3 runner (no snapshot committed until 3.1).
2.4 README. Each its own commit; nothing deleted until 4.1.

## 3 — Verify (live): commit the snapshots, prove the diff bites

**Target.** `scripts/vendor-facts.codesys.json` (SP21) and `vendor-facts.twincat.json` (Project14) committed, each value
checked against its DIALECT row; a hand-edited value makes the run exit 1 naming the fact and both values.

**Choice: a snapshot is committed only after TWO full runs agree.** The first run is `--write`; the second, a plain run,
must print "every fact as committed". A value that differs between the two runs is a probe finding, and the row's read
gets fixed before anything is committed. Rejected: *committing one `--write` run*, because a value that changes from
run to run (an ordering, a fresh name) would then fail the next user's run as if the vendor had changed. Each run is one
`ide.ps1` session on `-Instance vendor-fact-probe` (TwinCAT `-Fixture 14`), started by the runner. `ide-identity`'s `exe` read
must name SP21 and TwinCAT 3.1 / XAE before the snapshot is written; another version is refused, never recorded. Once a
snapshot is committed, the gate is its exact build (CODESYS `ProductVersion`; TwinCAT `TcRemoteManagerVersion`, shell
and shell version): a run on another build is refused naming both, never diffed (gate 3). Recording another build is
deliberate: move the snapshot aside and `--write`. A build's messages are a set: CODESYS lists one build's messages in
a different order run to run, so a `diagnostics` read is sorted (keyed without guids), as TwinCAT's already was.

- **`task-kind` int 0 leaves the table.** The 2.4 smoke run showed that it opens a modal "CODESYS" message box, which
  stops the UI thread, and the run ends on the timeout. C30 gets the answer as "recorded, not kept" (like C33): int 0
  is not converted to `Cyclic`, it opens a modal dialog. Rejected: *closing the dialog from the core*, which would add
  window automation for one fact; *recording the timeout as an outcome*, because the UI thread stays blocked and
  `cleanup` cannot run.
- **Locale is recorded, not normalized.** Refusal texts are verbatim in the IDE's UI language (nl-NL on the recording
  machine). `ide-identity` gains `{ key: "ui-culture", op: "process", what: "culture" }` on both vendors (one value
  added to the closed `process` set: `CultureInfo.CurrentUICulture.Name` in the core's process). On another machine the
  diff then names `ide-identity.ui-culture` beside the refusal texts that changed. Rejected: *stripping or
  normalizing messages*, because the verbatim text is the fact; *forcing en-US*, because that changes the owner's IDE
  language setup and was never measured.
- **DIALECT agreement is a read by a person, not a gate.** For each fact, 3.1's tasks.md note lists `fact → DIALECT
  row → agrees | finding`. A disagreement is written into the DIALECT row (dated, measured value, row id) in its own
  commit BEFORE the snapshot commit. Rejected: *checking values against the DIALECT prose by machine*, because the
  prose is not data.
- **3.2 runs live on the cheapest fact, once.** Change one value of `tc-task-items` (0.8 s) in the committed TwinCAT
  snapshot, run `bun scripts/vendor-facts.ts twincat --only tc-task-items`, and expect exit 1 with
  `tc-task-items.<key>: committed <edited> / measured <real>`. Then `git checkout --` the file. The diff is the
  runner's code and does not depend on the vendor, so one vendor is enough, and `vendor-facts.test.ts` already covers
  it offline. Rejected: *a committed "broken" snapshot fixture*, which is a second file to keep in step with the first.

**Refused by name:** an IDE version other than SP21 / Project14; a value that differs between the two runs; the NVL
(`absent`, as in 2); int 0 (a modal dialog, recorded in C30).

**Migration.** (a) The table drops `int-0`, adds the `ui-culture` read and the `culture` process read in both cores,
and adds an offline test for the `culture` read: one commit. (b) Any DIALECT findings: their own commit. (c) Both
snapshots plus the 3.1 note: one commit. (d) 3.2: no file changes; its result goes in the tasks.md note.

## 4 — Fold-ins: bridge-refusal-review's probes become rows; the NWL probes wait for the LD/FBD design

**Target.** `bridge-refusal-review` is archived (2026-10-04), so its kept probes and logs leave `scripts/`: each fact
is a table row with a `[PROBE: …]` marker, and `RefusedNamesMatchTheLogsTests` reads the snapshots, not the logs.

**Rows (4.1)** — vendors as each log measured; every write names `via`:
- `refused-names` (C T) ← `probe-member-name-refusal.ts` + its six logs. The candidates are FROZEN in the table as data:
  the 1494 distinct words the three runs asked (274 + 1201 + 421 asks), grouped (keywords, IL operators, elementary
  types, standard library, casing/controls, each family) so no group passes the cores' 500-item render limit (CODESYS
  refused 1092 of them, TwinCAT 933). One read per kind × group: the sorted refused words.
- `identifier-shapes` C28 (C T) ← `identifier-names.log`, `tc-refusal-measure-names.log` (42 shapes × 6 kinds).
- `task-priority-range` C19c (T) ← `tc-refusal-measure-priority.log`.
- `body-language-change` N24 (C T) ← `body-language-change`, `member-language-change`, `tc-refusal-measure-language`.
- `wire-type-contradiction` N25 ← `probe-wire-type-build.py`; `interface-accessor-write` D41 (C) ← its probe.
- **Missed by the proposal**, kept by the same archived change and cited in `scripts/README.md`: `move-target` C2q
  (C T) ← `probe-move-holders.py` (the fixture half; its corpus parent census is not a row), `probe-tc-move-target.ps1`;
  `body-view-switch` N23 (C T) ← `probe-view-switch.py`, `probe-tc-view-switch.{ps1,ts}`.

**Choice: `refused-names` writes `via: "script"`, and it runs in the default run.**
- Via script, because a push now meets the driver's own `RefusedName` pre-flight, which answers from the very list
  under test: the push would measure Volt. Rejected: *a pre-flight bypass flag* (a test hook in product code).
- In the default run, because a new vendor build that frees or reserves a word is the change this probe exists to
  catch. Measured cost (2026-10-03 logs, 1896 asks): CODESYS 557 s, TwinCAT 3472 s → ≈ 7 / ≈ 46 min for 1494 words.
  Rejected: *`--only refused-names` as opt-in*, because a default skip is a fact nobody re-asks.
- The gate becomes `RefusedNamesMatchTheSnapshotTests`: refused = the union of the kind × group reads, the split check
  (refused as one kind, accepted as another) kept. Rejected: *keeping the logs as the gate's input* (a second record
  of the same fact, written by a script the table replaced).

**Not rows:** `probe-library-signature-cost.py` + its eight logs (timings, not facts: the snapshot holds none) —
deleted once its finding is cited where it is used; `refusal-census.ts` (reads Volt's source) and `voltprobe.py` (the
CODESYS core's helpers) stay.

**4.2 stays open, refused by name.** No LD/FBD change exists yet. The rule it will apply: what a vendor model accepts,
holds or builds on a fixture is a row (`coils`, `boxoutputs`, `execute-create`, `execute-compare`, `slots`, `labels`,
`labels-edge-names`, `edge-names-order`, `eno-build`); a count over a real project is a corpus census and not a row
(`nwl-census`, `nwl-census-v2`, `nwl-dump`, `assign-outputs`, `oracle-rungs`, `coil-modifiers`). The design confirms.

**Migration.** (a) Rows + DIALECT markers (C28 C19c D41 N24 N25 C2q N23) + core reads: one commit. (b) Two agreeing
live runs per vendor; before any log goes, the snapshot's refused lists must equal the logs' (1092 / 933) — a
difference is a DIALECT finding first. (c) Gate switch + delete the probes and logs (+ README rows): one commit.
