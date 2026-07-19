Rebuild the Connector's connection model and surface from the ground up — no incremental patches on the
prototype context menu. The core abstraction is "a detected project you can connect to," with vendor as a
detail. Keep the ExternalAttach / InIdeLoad attach mechanisms distinct; unify the model + UX above them. No
change to the refs/fetch/push data path.

## 1. Domain model (the foundation — build this first) — DONE
- [x] `DetectedProject` (+ `ProjectRef`) — vendor-neutral: display name, vendor, dirty flag, and the opaque attach
      reference the bind needs. The ONLY project shape the UI knows. → `Volt.Cli.Connector.Core/DetectedProject.cs`
- [x] `IProjectSource` per vendor — a uniform enumerate/bind/probe contract; the boundary the ExternalAttach/
      InIdeLoad asymmetry lives behind. → `IProjectSource.cs` (impls come in §2).
- [x] `ConnectionManager` — owns the merged project list, per-vendor selection + health, the bind dispatch (routes
      by `DetectedProject.Vendor`), the aggregate status, and `Changed`/`Connected` events. The tray, window, and
      control plane are thin views over it — no vendor branching. → `ConnectionManager.cs`
- [x] Split the UI-free model into its own testable assembly `Volt.Cli.Connector.Core` (net8.0, no WinForms);
      moved `HealthProbe`/`BridgeHealth`/`BridgeStatus` there; the WinForms shell references it (same namespace).

## 2. Wire op (shared Core, per-vendor impl)
- [x] Connector-side client: `IBridgeWire` (+ `PipeBridgeWire`) and ONE `PipeProjectSource` that serves BOTH
      vendors over the same `instances`/`select`/`health` ops — all asymmetry stays behind the wire. Maps the
      instance→project(→sub-project) tree to flat `DetectedProject`s (TC PLC sub-projects each become an entry;
      CODESYS project is one). Tested against the wire contract with a fake wire (5 tests).
- [ ] Bridge side — add `instances` + `select` ops to the pipe router (`BridgePipeHost`) + the `IIdeDriver`
      contract; one wire shape for all vendors.
- [ ] TwinCAT worker: implement it over the existing COM/ROT + `FindTwinCatProject`/`FindPlcProject` paths
      (`select` = `ReattachProject` on the live DTE, no worker respawn).
- [ ] CODESYS in-proc host: implement it over `ScriptProjects`; `select` rebinds the host's active project.

## 3. Unified selector + notifications
- [ ] The connector merges all sources into ONE list of `DetectedProject`; the user picks one (no vendor choice).
- [ ] Each entry shows its platform via a prefix or vendor logo; selection routes through `ConnectionManager` to
      the correct bridge bind.
- [ ] On connect, emit a notification that NAMES the platform (toast + tray tooltip): "Connected to <project> (<vendor>)".
- [ ] `BridgeView`/control-plane snapshot carries the merged `DetectedProject` list (drop the hardcoded `null`).

## 4. Remove the launch model (delete, don't wrap)
- [ ] Delete the CODESYS launch path outright: `PopulateInstalls`/`LaunchInstall`/`AddInstall`, `VendorProvider`
      `IdeExe`/`IdeLaunchArgs`/`Installs`/`CanLaunchIde`, `ConnectorConfig.BuildCodesysLaunchArgs`, `/launch` +
      its callback, and the launch-oriented parts of `CodesysDiscovery`.
- [ ] Add guided activation as a first-class, low-key affordance (not a vendor lane): the steps + a **Copy
      activation command** action, shown when a CODESYS project isn't yet detectable (host not loaded).

## 5. Volt-branded window (designed, MVVM over ConnectionManager)
- [ ] A proper window carrying Volt identity — bolt + wordmark + the volt-www palette/fonts/pill buttons (port the
      console-rebrand tokens; see `style/volt-theme.css`). Centerpiece: the unified selector + connection status.
- [ ] The tray context menu shrinks to a minimal launcher (Open Volt · Show logs · Collect diagnostics · Exit);
      the tray icon (aggregate color) + toasts remain, driven by the `ConnectionManager` status.
- [ ] Consistent status vocabulary (Waiting for a project · Connected to X · Degraded · Activate to see CODESYS).

## 6. Cleanup
- [ ] Fix the stale "HTTP wire" language in `Connector/README.md` (data + health wire is named pipes; only `:8550`
      control plane is HTTP). Rewrite the README to the new model.
- [ ] Implement **Collect diagnostics** (the README advertises it): bundle logs + `health` + versions to a zip.
- [ ] Resolve the "config JSON next to the exe later" TODO — a minimal config or drop the note.
- [ ] Update `ARCHITECTURE.md` for the CODESYS activation model + the `DetectedProject`/`ConnectionManager` design.

## 7. Tests
- [x] Unit: `ConnectionManager` merges sources, dispatches bind to the right vendor, tracks aggregate status,
      drops a vanished selection, survives an unreachable source (9 tests, `Volt.Cli.Connector.Tests`).
- [ ] Unit: the `instances` op + bind for both vendors (fake IDE / pipe transport).
- [ ] Live parity: TwinCAT + CODESYS both reach "connected to <project>" via one selector, no launch step; the
      copied CODESYS activation command loads the host (extends the `codesys-pipe` smoke).
