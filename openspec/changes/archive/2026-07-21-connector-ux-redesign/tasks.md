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
- [x] Bridge side — `instances` + `select` ops added to `BridgePipeHost` + the `IIdeSession` contract (abstract
      in `DriverBase`); one vendor-neutral wire shape in Core (`IdeInstance`/`IdeProject`/`InstancesResult`/
      `SelectRequest`). `FakeIde` implements them (scriptable). Contract test proves the bridge shape ↔ the
      connector parser agree.
- [x] TwinCAT worker: `EnumerateInstances` maps the existing `RotInstances.Enumerate()` (all running XAE
      instances + PLC sub-projects); `SelectProject` → new `TcObjectModel.SelectProject` re-resolves the chosen
      instance/project on the live DTE (re-binds the DTE only if a different instance is named — no worker respawn).
      ⚠ needs live-TwinCAT verification (COM re-resolve path).
- [x] CODESYS in-proc host: `EnumerateInstances` reports the primary project (one instance/project, no subs);
      `select` confirms/refreshes that binding — the host can only serve the CODESYS it was loaded into.
      ⚠ needs live-CODESYS verification.

## 3. Unified selector + notifications — DONE
- [x] `TrayContext` rewired over `ConnectionManager`: the "Connect to" menu is ONE list of `DetectedProject`
      across all vendors; the user picks one (no vendor choice) → `ConnectionManager.ConnectAsync` routes by vendor.
- [x] Each entry shows its platform prefix (`TwinCAT · <project>` / `CODESYS · <project>`, dirty `*`), connected
      one checked.
- [x] Connect notification NAMES the platform ("Connected to <project> (<vendor>)"); tray tooltip summarizes
      connected/detected. Aggregate-down toast on disconnect.
- [x] Control plane reshaped to `ConnectorView` (aggregate status + the one merged project list); `/connect
      {projectId}` binds via the model. No more hardcoded `null` instances.

## 4. Remove the launch model (delete, don't wrap) — DONE
- [x] Deleted outright: `VendorProvider`, `CodesysDiscovery` (+ `IdeInstall`), the old `Instances`
      (`TcInstanceDto`/`TcTarget`), the install picker, `/launch`, and the whole IDE-launch path in
      `BridgeSupervisor`. Replaced by `ConnectorSetup` (sources + worker specs) + a slimmer supervisor (spawn
      workers only, no launch, no target env — select is a wire op).
- [x] Guided activation as a low-key affordance: `CodesysActivation` (steps + the `start_pipe.py` path) + a
      "Activate in CODESYS…" menu item that copies the script path to the clipboard and shows the steps; also
      surfaced inside the empty "Connect to" list.
- [x] Implemented **Collect diagnostics** (`Diagnostics.Collect` — zips logs + a snapshot to the Desktop).

## 5. Volt-branded window (designed, view over ConnectionManager) — DONE
- [x] `ConnectorWindow` — a Volt-identity `Form`: the bolt + "Volt Connector" wordmark, `VoltTheme` (the volt-www
      "Cursor look" tokens — warm off-white surfaces, ink text, orange accent, dark pill CTA), rounded project
      cards with a platform badge + a Connect/Connected pill. Re-renders on `ConnectionManager.Changed`.
- [x] It's the primary surface — the tray icon double-click + a bold "Open Volt" open it; the context menu keeps
      quick actions (Connect to · Activate · Logs · Diagnostics · Exit) as a shortcut. Tray icon + toasts driven
      by the model.
- [x] Consistent status vocabulary in `VoltTheme.StatusWord` (Connected · Degraded · Waiting for a project · No
      bridge running · Idle). ⚠ needs a visual smoke-test on a live desktop.

## 6. Cleanup — DONE
- [x] Rewrote `Connector/README.md` to the new model: named-pipe data wire (only `:8550` is HTTP control plane),
      the `ConnectionManager`/`DetectedProject` design, guided CODESYS activation (no launch), correct config vars
      (`VoltBridgeTwincat.exe` / `start_pipe.py`).
- [x] Implemented **Collect diagnostics** (`Diagnostics.Collect` — logs + snapshot → Desktop zip).
- [x] Resolved the "config JSON later" TODO — dropped (env overrides suffice; no demand).
- [x] Updated `ARCHITECTURE.md` — added `Volt.Cli.Connector.Core` + the no-launch note.

## 7. Tests
- [x] Unit: `ConnectionManager` merges sources, dispatches bind to the right vendor, tracks aggregate status,
      drops a vanished selection, survives an unreachable source (9 tests, `Volt.Cli.Connector.Tests`).
- [x] Unit: the `instances`/`select` wire contract — bridge `InstancesResult` serializes into the connector's
      `DetectedProject`s (TwinCAT multi-PLC + CODESYS single), and the connector's select payload reads back as a
      `SelectRequest` (3 contract tests). Core services + `FakeIde` build green with the new ops.
- [x] **Live verification (needs real IDEs — the last gate):** (a) TwinCAT + CODESYS both reach "connected to
      <project>" via the one selector, no launch step; (b) the copied CODESYS activation command loads the host;
      (c) the TC `SelectProject` live re-resolve; (d) a visual smoke-test of `ConnectorWindow` on a desktop.
