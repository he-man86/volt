# Live-bridge e2e — running it

This suite drives a **live IDE bridge** over the named pipe (the same wire the CLI uses). It is a **local tier**,
not CI: it needs a real CODESYS or TcXaeShell running, so it can't run headless on a build agent. The *same* suite
runs against either vendor — a pass on one and a fail on the other is a real parity bug, not an expected difference.
Tests provision their own `VltE2E_*` items and clean them up, so they never depend on ambient project content.

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

`scripts/codesys-pipe.ps1` loads the in-proc pipe host into CODESYS against a **copy** of the fixture (never your
live IDE). Two modes:

```powershell
# headless (fast dev/CI-ish loop) — no window, --noUI
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up
# GUI — production-like: the real IDE, the same in-proc host a user activates via "Activate in CODESYS"
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Ui
# multiple instances (per-pid pipes): -Instance a / -Instance b
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Instance a
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 down          # (add -Instance a to stop that one)

bun run test:e2e:codesys   # discovers the live codesys pipe + runs the suite
```

## TwinCAT

TwinCAT has **no in-proc host and no headless mode** (TcXaeShell is Visual-Studio-based). The connector's
`VoltBridgeTwincat` worker attaches to whatever XAE windows are running over the COM ROT, so the launcher only
*opens* the fixtures:

```powershell
pwsh packages/volt-cli/scripts/twincat-instances.ps1 up            # both fixtures = the multi-XAE scenario
pwsh packages/volt-cli/scripts/twincat-instances.ps1 up -Which 13  # just one
pwsh packages/volt-cli/scripts/twincat-instances.ps1 down          # close the ones it opened

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
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up
pwsh packages/volt-cli/scripts/twincat-instances.ps1 up -Which 13
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
