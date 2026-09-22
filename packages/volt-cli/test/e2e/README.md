# Live-bridge e2e — running it

This suite drives a **live IDE bridge** over the named pipe (the same wire the CLI uses). It is a **local tier**,
not CI: it needs a real CODESYS or TcXaeShell running, so it can't run headless on a build agent. The *same* suite
runs against either vendor — a pass on one and a fail on the other is a real parity bug, not an expected difference.
Tests provision their own `VltE2E_*` items and clean them up, so they never depend on ambient project content.
And `requireHealthy()` sweeps any `VltE2E_*` a PREVIOUS run left behind, once per process, before any test runs —
because `cleanup()` lives in `afterAll`/`afterEach`, which is exactly where it does not run when a test TIMES OUT.
Without that sweep one bad run poisons the next, and the failure count climbs run over run.

## Known: the suite flakes in a FULL run, never in isolation

Two different tests have failed once each in a whole-suite run and passed on a re-run and when run alone:
`graphical/grouping` (network counts) and `items/clear` (an emptied ACTION body). Neither is a product bug — the
same binary passes them minutes later — and neither has ever failed twice.

**The cause is cleanup discipline, and it is not uniform.** Some files sweep in `beforeEach`, some only in
`beforeAll`/`afterAll`, and two clean nothing but their own items on the happy path — so an assertion that throws
mid-test leaks an item for the rest of the process. `sweepOnce` in `lib/workspace.ts` catches leftovers from a
PREVIOUS run, once per process; it cannot help a file that runs after a leak inside the same run. That is the
cascade its own comment records as measured (4/1/2/7 failures across runs, against 159/1 from a restored fixture).

So a single red in a full run is worth re-running before believing; a red that reproduces is real. Making every
file clean per-test — and moving the leak-prone ones onto `expectRoundTrip`/`removeItem`, which clean regardless
of how a test exits — is the remaining half of the suite rebuild.

## Cleaning up: through the BRIDGE, never `git restore`

**If a run leaves the fixture project dirty, clean it over the wire and let the IDE close normally.** Delete the
leftover items through the bridge (`cleanup()` does this; `requireHealthy()` now does it for you), then stop the
IDE with `ide.ps1 down -Vendor twincat` / `ide.ps1 down -Vendor codesys`.

`git restore` on a fixture **while the IDE has it open** does not clean anything — it fights the IDE. TwinCAT
holds its own in-memory model of the project and writes it back on save, so restoring files underneath it leaves
disk and IDE disagreeing about the same project, and the next save undoes the restore. Measured 2026-09-03:
after a bridge-clean and an orderly shutdown the fixture came back with **zero modified files**, including the
`LineIds` churn that had looked unavoidable while restoring under a live IDE.

**Pick a vendor with `VOLT_VENDOR`; the harness does the rest.** It **discovers the live per-pid pipe** by prefix
(so an IDE that restarts with a new pid is followed — no need to hunt for `volt.bridge.<vendor>.<pid>`), and
`requireHealthy()` **selects the detected project and waits for it to serve** (CODESYS serves its project by default;
a TwinCAT XAE starts every project `idle` and must be told which to serve — the harness does that). `VOLT_PIPE` still
overrides for a specific pipe/prefix. One command per vendor:

```bash
bun run test:e2e:codesys      # = VOLT_VENDOR=codesys bun test test/e2e
bun run test:e2e:twincat      # = VOLT_VENDOR=twincat bun test test/e2e
```

## Fixtures (committed, deterministic)

Instead of running against whatever you happen to have open, the suite targets committed fixture projects under
`packages/volt-cli/test/`:

| Fixture | Vendor | Use |
|---|---|---|
| `CodesysTestProject.project`, `testproject1.project` | CODESYS | single / multi-instance |
| `Untitled1.project` | CODESYS | **hand-authored**: `FB_GraphicalChild` (ST FB + **CFC method child**), `FB_FolderChild` (**action inside a folder**) |
| `TwinCAT Project13/`, `TwinCAT Project14/` | TwinCAT | single / **multi-XAE** |

`Untitled1.project` holds the two shapes the write path is hardest on, both hand-authored because a test cannot
provision the first at all (CFC is unsupported, so Volt never creates one):

- `FB_GraphicalChild` — a graphical CHILD under a textual parent, the exact shape of the first write-path data-loss bug.
- `FB_FolderChild` — a child inside a POU-internal folder, the structure a PLCopen import flattens.

Their recorded exports are committed under `Volt.Engine.Tests/fixtures/codesys-pou/` so the offline splice tests get
the same ground truth without an IDE — including `FB_ChildFolderStructure.plcopen.xml`, an export taken with
`bExportFolderStructure=True` to pin the `projectstructure` block the import discards.

The TwinCAT fixtures are committed **source-only** — a `test/.gitignore` strips the regenerated build cache
(`_CompileInfo`, `_Boot`, `_Libraries`), which is ~140 MB. TwinCAT re-resolves system libraries and rebuilds on open.

## CODESYS

`scripts/ide.ps1` loads the in-proc pipe host into CODESYS against the committed **fixture** (never
your live IDE). Two modes:

> It opens the fixture **in place** — `run_pipe_production.py` calls `projects.open(path)` on the committed file.
> This said "a copy" until 2026-09-03 and there has never been one; the claim had also reached CLAUDE.md and
> a change proposal, where it was used to argue TwinCAT should copy too.
>
> **The fixture survives anyway because of the STORAGE MODEL, not a copy.** A CODESYS project is one file
> that is written on SAVE, and nothing in this loop saves — so items created and deleted during a run
> exist only in memory. That is a property of the RUN, not of the IDE: the GUI marks the project dirty
> (`Project*` in the title bar) and a human who hits Ctrl+S, or answers "save?" on close, commits the e2e's
> churn to the fixture. Tear down with `ide.ps1 down`, which force-closes and discards.
 TwinCAT stores one file per POU and writes them as it goes, which is why the same
> suite leaves its fixture modified on one vendor and pristine on the other. That asymmetry is the whole
> reason `twincat-e2e-fixture-hygiene` exists.

```powershell
# ONE mode: a normal GUI CODESYS running the SHIPPED start_volt_codesys.py
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys
# multiple instances (per-pid pipes): -Instance a / -Instance b
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys -Instance a
pwsh packages/volt-cli/scripts/ide.ps1 down -Vendor codesys          # (add -Instance a to stop that one)

bun run test:e2e:codesys   # discovers the live codesys pipe + runs the suite
```

**There is one way to serve CODESYS, and it is the way users do it.** There used to be three — `-Ui`, and a
HEADLESS default that opened the IDE with `--noUI` and pumped the message loop from `run_pipe_headless.py`,
because a headless IDE has none running. That harness is deleted. It loaded the bridge straight from the build
output and owned the loop, so the e2e tier spent its life proving a path that ships with nothing — and the IDE
was unusable while it served, because the pump held the primary thread.

`start_volt_codesys.py` — the script that ships, run verbatim by `run_pipe_production.py` — stages the bridge
into a **per-session temp copy** (which is what lets an install update while the IDE is open) and returns
immediately, leaving the **IDE's own message loop** to serve the pipe. The window is then a normal CODESYS you
can click around in while the suite drives it. Measured 2026-09-05, before the deletion: 189 pass / 0 fail on
both hosts, so the harness was not hiding a defect — it was hiding a difference. Stop it the way a user does,
from the IDE: `stop_volt_codesys.py` (or `ide.ps1 down -Vendor codesys`, which kills the pid it launched).

The one thing the harness did that the shipped script does not is silence .NET assertion dialogs; that moved
into `run_pipe_production.py`, which is the right home — an engineer at their desk wants to see an assertion,
an unattended sweep must never stop on a modal window, and a modal window blocks COM outright.

> SP21's scripting engine is **Python 3**. Several comments in the shipped scripts still say "IronPython
> 2.7" — true of SP18, not of SP21. It matters: `execfile()` does not exist there, and the
> `DeprecationWarning` it raises lands in CODESYS's message store, which `build` reads — so a script-level
> mistake surfaces as two phantom *build errors* in every test that compiles.

## TwinCAT

TwinCAT has **no in-proc host and no headless mode** (TcXaeShell is Visual-Studio-based). The connector's
`VoltBridgeTwincat` worker attaches to whatever XAE windows are running over the COM ROT, so the launcher only
*opens* the fixtures:

```powershell
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor twincat            # both fixtures = the multi-XAE scenario
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor twincat -Which 13  # just one
pwsh packages/volt-cli/scripts/ide.ps1 down -Vendor twincat          # close the ones it opened

# TcXaeShell takes ~30-60s to load; the runner discovers the pipe + selects the project + waits, so just:
bun run test:e2e:twincat
```

**One-time build per fixture.** The committed fixtures ship source-only (no `_CompileInfo`), so a freshly-opened
one isn't fully serveable until it's built: **Build → Build Solution** in TcXaeShell once after opening. Until then
the DTE registers but the PLC project isn't fully accessible; `requireHealthy()` selects it and waits, and if it
never serves within 60s the suite fails with a clear message ("selected it but it stayed idle — is the IDE still
loading?"). The connector must be running (it supervises the worker).

## A note on TwinCAT stability

TcXaeShell is an out-of-process COM automation target and is **best-effort by nature** — a window can go busy,
re-register its DTE (the ROT moniker is ephemeral), drop a call with `0x800706BA`, or even close on its own. The
bridge is built to survive this: it recovers a selection by **stable project name** (not the ephemeral moniker),
retries a transient read once after re-acquiring, and otherwise refuses cleanly with `PLC_DISCONNECTED` + a full ROT
diagnostic in the log (`%LOCALAPPDATA%\Volt\logs\twincat-*.log`). If a run flaps, it's the IDE, not the bridge —
restart the XAE windows for a clean multi-XAE environment. `library-signature` tests are CODESYS-only
(`skipIf twincat`): TwinCAT has no signature-extraction surface yet (a tracked parity gap).

### And a WORN project is its own failure mode — measured 2026-09-22

A long session against one served project degrades it, and the degradation does not look like wear. After a
day of creates, deletes, refused pushes and hand-drawn POUs, the SAME commit gave:

| | worn project | fresh copy |
|---|---|---|
| `graphical/` suite | 93 pass, **1 fail**, 540 s | 94 pass, 0 fail, **127 s** |
| `refs` | ~260 ms | **29 ms** |
| empty push | ~490 ms (on the 500 ms limit) | **86 ms** |

The failure was a create whose DECLARATION came back empty — a data-loss shape, reproducible, and identical on
`HEAD` with every local change stashed. That is what makes it worth writing down: it reads exactly like a
product regression, and the only thing that distinguished it was re-running against a fresh `ide.ps1 up`.

Two practical rules follow. **Suspect the project before the code when a live failure appears without a
matching change**, and confirm by stashing rather than by reasoning. And **compare like with like**: the
latency baselines in `stability/latency.test.ts` were recorded on `TwinCAT Project13` (9 items), while a
session that happens to bind `Project14` (17 items, PackML FBs, several graphical bodies) reads 8x worse and
invites a vendor-performance conclusion the numbers do not support. `ide.ps1 up` opens BOTH, and discovery
takes the first live pipe — so which project a run measures is not something the run chooses.

**And the suite USED TO PASS ON LITTER, which is the sharpest version of this.** `plcFolder(sub)` builds its
path from `plcRoot()`, the MAIN program's own folder — so in a project whose main program lives in `POUs`, the
default `plcFolder("POUs")` asked for `POUs/POUs`. Per-test cleanup deletes ITEMS and leaves FOLDERS (D34), so
the FIRST run against such a project created that folder on its way to failing and every run after it found
the folder already there and passed. A fresh `ide.ps1 up` is what exposes it — a bug that appears only after
the one action that makes everything else clean, and whose symptom names neither the doubling nor the harness.
Fixed in `plcFolder`; the note is here because the SHAPE recurs.

**It also decides where the PLC ROOT is**, and that failure does not look like a project difference either:
the harness default folder `POUs` resolved to `POUs/POUs` on one of the two, and FIFTY-EIGHT tests failed with
`ITcSmTreeItem:CreateChild failed: Could not find a part of the path ...\POUs\POUs\X.TcPOU` — a vendor error
naming neither the cause nor the project. `requireHealthy` prints `[e2e] serving project: <name>` now, once per
run, so the first line of any red run says which of the two it was.

**And it changes what is COVERED, not only what is timed.** The same sweep skips **20** tests on Project13
and **8** on Project14, because several suites gate on the project being big enough to be meaningful
(`if (itemCount >= 20)`, a POU with children, a folder two deep). A green run says nothing about which of
the two it was, so read the SKIP count as part of the result, not as noise.

## The two suites that are not single-vendor

Every file here drives ONE bridge, chosen by `VOLT_VENDOR`/`VOLT_PIPE` — except two, and both say so on stdout
when they skip rather than vanishing quietly. A silent skip is how the TwinCAT graphical-move test stayed off
through the entire implementation of the move it was skipping.

**`vendor-parity.test.ts` needs BOTH IDEs up at once.** It pushes identical source to CODESYS and TwinCAT and
diffs what comes back, which is the invariant `ARCHITECTURE.md` opens with and which nothing else checks:
`child-roundtrip-parity` runs the same assertions against one bridge at a time, so it catches an absolute failure
(TwinCAT dropping FBs with methods) but not a difference the two vendors both handle plausibly — a stray blank
line, a reordered VAR block — which passes twice and is invisible. Run both launchers, then either vendor's
command; the suite finds the other pipe itself via `livePipesFor`.

```bash
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys
pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor twincat -Which 13
bun run test:e2e:twincat        # vendor-parity runs; everything else drives TwinCAT
```

**`graphical/unsupported.test.ts` runs on both**, but only because both fixture projects carry a committed
CFC and SFC POU (`VltFixtureCfc` / `VltFixtureSfc`). Volt can never create one — a diagram has no text form to
push — so each IDE authored its own: CODESYS via `create_pou(language=cfc|sfc)` in a `--runscript`, TwinCAT via
`CreateChild(name, 602, "", "CFC")` over the COM ROT. Their KIND differs by vendor (`.fb` on CODESYS, `.prg` on
TwinCAT) and the suite resolves the wire names from `refs` rather than assuming an extension. **If you ever
regenerate a fixture project, these two POUs must survive** — without them the suite fails loudly rather than
skipping, which is deliberate: silently losing the only live coverage of a data-loss guard is the failure mode
worth being noisy about.

**`graphical/refused-shapes.test.ts` runs on both, and expects a DIFFERENT verdict from each.** Four bodies -
an unconditional `JMP`, an unconditional `RETURN`, an `EXECUTE` box, and a box output pin wired straight to a
variable - push clean to CODESYS and are refused by the TwinCAT driver. Every refusal blames TwinCAT's PLCopen
importer and **none of them has been put to the IDE**: they are the driver's rules, and "TwinCAT cannot" reads
exactly like "Volt does not" from outside. So the suite carries a table of which shapes are refused where, and
**fails when a driver learns one** - "took it, take it off the list" - which is the only thing that keeps a
list of known gaps honest. It asserts two properties that hold whichever way each one goes: an accepted push
round-trips BYTE-IDENTICAL, and a refused push writes NOTHING.

That second one was false when the suite was written - the output-pin case pushed two items, wrote the first
and refused the second - and it is what made the fix findable. The refusals come from TwinCAT's PLCopen
writer, which is a pure function of the parsed body, so `ICodeStore.ValidateSource` now runs it in
`PushService`'s pre-flight and the whole family is refused before the first write. On a CREATE only: an update
rewrites just the networks that CHANGED, so a body may legitimately carry a shape the whole-body writer refuses
in a network the edit does not touch.

These four are also the only LSP conformance fixtures with no TwinCAT recording, which is how the asymmetry
surfaced: the recorder cannot push them either.

## Not a suite: the corpus-migration GAP FINDER

`scripts/corpus-migration.ts` pushes a real customer project (the `volt-lsp-iec/test-corpus/` harvests) into an
**empty** CODESYS project and materializes the result back. Every item is therefore a **create**, which is the
half `whole-project.test.ts` cannot reach — that one pushes a project's own bytes back over itself and so only
ever exercises the update path.

**It is deliberately NOT a test.** The corpora are large, slow, and prove nothing on a build agent; their job is
to *surface* gaps. Every gap it finds is fixed and then pinned by a dedicated **offline** test in `volt-cli`
that fails without the fix — that test is the standing coverage, not the corpus run.

```bash
bun run scripts/corpus-migration.ts             # every corpus (~5-20 min each)
bun run scripts/corpus-migration.ts pro2193     # one
```

It owns the IDE lifecycle (opens and closes a throwaway blank project per corpus), so stop any running bridge
first. CFC/SFC/IL items are counted and reported rather than staged: they have no text form to create them from.

| Found | Fixed in | Pinned by |
|---|---|---|
| Create path wrote a `(* @volt-graphical: LANG *)` marker as source, landing an EMPTY function block while the push reported success — a migration silently dropped every CFC/SFC POU | `BodyFormatGuard.RequireAuthorable`, called on the create arm of `PushService` | `Volt.Engine.Tests/sync/CreateUnauthorableBodyTests.cs` |
