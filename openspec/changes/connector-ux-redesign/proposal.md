## Why

The Connector is the **single user-facing Volt app** — the tray supervisor every customer runs — but it still
reads as a prototype:

- **The surface is a bare gray context menu.** No window, no Volt identity, terse states ("not running", "no
  project loaded"). It doesn't look like the branded product the console/site/extension now are.
- **CODESYS is connected the wrong way.** The connector *launches* CODESYS for the user (`--runscript`), which
  drags in 246 lines of install discovery (glob + registry + a manual "Add install…" picker) and a whole launch
  path. In practice engineers already have CODESYS open on the project they care about; having Volt spawn a
  second IDE instance is intrusive and fragile.
- **Project selection is half-built for *both* vendors.** `BridgeView.Instances` is hardcoded `null`, and the
  TwinCAT "Connect to" submenu only shows the *current* target — it never enumerates the open projects to pick
  from. Selection only works via env vars or the control-plane `/select` (tests/VS Code). The tray user can't
  actually choose a project.

The result is two divergent, incomplete flows (launch-CODESYS vs. attach-TwinCAT) behind an unbranded menu.

## What Changes

**1. CODESYS: stop launching it; user activates, connector detects + selects (like TwinCAT).**
- **Remove the launch entirely** — delete "Open CODESYS (Volt)"/`LaunchInstall`/`AddInstall`, the install picker,
  `IdeLaunchArgs`/`BuildCodesysLaunchArgs`, the `/launch` control endpoint, and nearly all of `CodesysDiscovery`
  (we no longer need to find installs to launch). The connector never opens an IDE.
- **Add a clear "Activate in CODESYS" affordance** — a short, explicit description of how to load the Volt pipe
  host into an *already-open* CODESYS (Tools → Scripting → run `start_pipe.py`), plus a **"Copy activation
  command"** action that puts the exact one-liner / script path on the clipboard. No auto-launch, no guessing.
- **Detect + select the project** — once the user activates the script, the in-proc host serves the pipe; the
  connector detects it (existing health probe) and asks it to **enumerate the open project(s)**. The user picks
  one; the host binds it. Same detect → pick → connected UX as TwinCAT.

**2. ONE list — the user just picks a detected project.**
- No "CODESYS vs TwinCAT" choice. The selector is a **single list of every detected project across all vendors**
  — "Connect to: [ MyMachine · … ]". Each entry shows **which platform it is** via a short prefix or a small
  vendor logo (e.g. a CODESYS / TwinCAT glyph), so you can tell at a glance — but it's one list, picked as one
  action, never a vendor-split UI. Pick a project; the connector attaches via that project's mechanism.
- On connect, the **notification names the platform** — e.g. *"Connected to MyMachine (CODESYS)"* — so the toast
  and tray tooltip say what it attached to, not just the project name.
- Feed it with a symmetric **`instances` enumeration op** on the pipe wire: the TwinCAT worker lists running
  instances + their projects (it already has the COM/ROT path + the `TcInstanceDto` shape); the CODESYS in-proc
  host lists its open projects. Both return the same shape; the connector merges them into one list, each entry
  carrying its **vendor** (for the prefix/logo + to route selection to the right bridge's `/select`).
- Wire `BridgeView.Instances` to the real enumeration (drop the `null`).
- Keep the two attach **archetypes** intact (ExternalAttach vs InIdeLoad — the load-bearing asymmetry Volt must
  not unify): the *mechanism* stays per-vendor; only the *selector* is unified.

**3. A Volt-branded, enterprise status window (the primary surface).**
- Replace the bare context menu as the main interaction with a small, polished window carrying Volt identity —
  the bolt + wordmark, the volt-www palette + fonts + pill buttons (the same tokens the console rebrand used).
- The centerpiece is the **unified project selector** above, plus the current connection status and a dirty
  indicator. No per-vendor cards.
- **Activation is a secondary hint, not a vendor lane.** Because a CODESYS project only becomes detectable once
  its in-proc host is loaded, the window carries one unobtrusive *"Don't see your CODESYS project? Activate Volt
  in CODESYS"* affordance (the steps + the **Copy activation command** action). It's the one place vendor
  specifics surface — and only because CODESYS genuinely needs a load step; TwinCAT projects just appear when the
  IDE is open.
- The tray icon (aggregate color) + toasts stay; the context menu shrinks to a light launcher (Open Volt · Show
  logs · Collect diagnostics · Exit).

**4. Clean up the prototype edges.**
- Fix the stale "HTTP wire" language in the Connector README (the data + health wire is named pipes).
- Add the **"Collect diagnostics"** action the README advertises but the menu never had (bundle logs + health +
  versions for a support ticket).
- Resolve the "config JSON next to the exe later" TODO — either a minimal config file or drop the note.
- Consistent, human status vocabulary across vendors (Activate needed · Waiting for project · Connected to X).

## Design notes

- **The activation instruction is the crux of the CODESYS change.** Because CODESYS has no external attach API,
  the bridge must run *inside* it — but the connector should *guide*, not *drive*. The affordance names the exact
  steps + copies the exact command, so activation is a deliberate, transparent user action against the IDE they
  already have open.
- **"Select project" for CODESYS** is meaningful even when one project is open (project vs. library, or multiple
  open projects); the in-proc host enumerates `ScriptProjects` and binds the chosen one — the CODESYS analogue of
  the TwinCAT worker choosing a PLC project under the DTE.

## Approach — a ground-up rebuild, not patches

This is **not** incremental edits to the existing `TrayContext` context menu. The current surface encodes the
prototype's assumptions (per-vendor submenus, a launch action, `Instances = null`), and bolting a unified
selector onto it would carry that shape forward. Instead, build the connection model from the ground up:

- **A single domain model.** A vendor-neutral `DetectedProject` (display name + vendor + the opaque attach
  reference) is the one thing the UI knows about. A uniform `IProjectSource` per vendor enumerates them (TwinCAT
  over COM/ROT; CODESYS over the in-proc `ScriptProjects`); a `ConnectionManager` owns the merged list, the
  current selection, the bind dispatch, and the status — the tray, the window, and the control plane are all thin
  views over it. The vendor is data on a `DetectedProject`, never a branch in the UI.
- **The window is designed, not grown.** A proper Volt-branded window (MVVM over the `ConnectionManager`), not
  the context menu with more items hung off it. The context menu becomes a minimal launcher into it.
- **Delete, don't wrap.** The launch/install-discovery machinery is removed outright (not hidden behind a flag),
  so the new model isn't shadowed by the old one.

The result is a connector whose core abstraction *is* "a detected project you can connect to," with vendor as a
detail — which is exactly the UX above, expressed in the architecture rather than patched on top of it.

## Impact

- **`packages/volt-cli/src/Volt.Cli.Connector`** — `TrayContext` (rework the surface + pickers), `VendorProvider`
  (drop CODESYS launch fields), `ControlServer` (drop `/launch`, keep `/select`, surface `instances`),
  `HealthProbe`/`Instances` (enumeration), a new Volt-branded window, README. **Deletes** `CodesysDiscovery`
  (most of it) + the launch path — a net LOC reduction alongside the new window.
- **`packages/volt-cli/src/Volt.Cli.Core`** — a new `instances`/`projects` enumeration wire op in the shared
  contract; the CODESYS in-proc host and the TwinCAT worker each implement it (parity at the wire, per vendor).
- **No change to the sync data path** (refs/fetch/push) — this is connection UX + the enumeration op only.

## Non-goals

- **Not unifying the attach archetypes.** ExternalAttach (TwinCAT) and InIdeLoad (CODESYS) stay distinct; only
  the UX converges.
- **Not auto-launching or auto-activating any IDE** — CODESYS activation stays a guided, explicit user step.
- **Not a full desktop-app rebuild** — the window is a small, fast connector surface, not the Volt desktop shell
  (`volt-desktop` remains the IDE-panel app).
