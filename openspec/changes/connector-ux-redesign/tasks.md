Redesign the Connector: stop launching CODESYS (guided user-activation instead), finish project
selection for both vendors, and give it a Volt-branded enterprise surface. Keep the ExternalAttach /
InIdeLoad archetypes distinct — unify the UX, not the mechanism. No change to the refs/fetch/push data path.

## 1. CODESYS — remove the launch, add guided activation
- [ ] Delete the launch path: `TrayContext.PopulateInstalls`/`LaunchInstall`/`AddInstall`, `VendorProvider`
      `IdeExe`/`IdeLaunchArgs`/`Installs`/`CanLaunchIde` (CODESYS side), `ConnectorConfig.BuildCodesysLaunchArgs`.
- [ ] Delete `/launch` from `ControlServer` (+ the `launch` callback wiring in `TrayContext`).
- [ ] Remove most of `CodesysDiscovery` (install glob/registry/manual) — keep only what's needed to point at the
      shipped `start_pipe.py` for the activation command; delete the rest.
- [ ] Add an **"Activate in CODESYS"** affordance: step-by-step text (open CODESYS → Tools → Scripting → run the
      script) + a **"Copy activation command"** action that copies the exact one-liner / `start_pipe.py` path.

## 2. Project enumeration + selection (both vendors)
- [ ] Shared Core: add an `instances` (open projects) enumeration wire op returning the `TcInstanceDto`/
      `TcProjectDto` shape for both vendors.
- [ ] TwinCAT worker: implement `instances` — list running instances + their PLC projects (reuse the existing
      COM/ROT + `FindTwinCatProject`/`FindPlcProject` paths).
- [ ] CODESYS in-proc host: implement `instances` — enumerate open `ScriptProjects`; `/select` (equivalent)
      rebinds the host's active project.
- [ ] Connector: fill `BridgeView.Instances` from the enumeration (drop the hardcoded `null`); build a real
      **project picker** in the surface for both vendors; selection routes through `/select`.
- [ ] Verify the "no project selected → pick → connected" flow works identically for TwinCAT and CODESYS.

## 3. Volt-branded enterprise surface
- [ ] New status **window** carrying Volt identity — bolt + wordmark, the volt-www palette + fonts + pill buttons
      (port the same tokens the console rebrand used; see `style/volt-theme.css`).
- [ ] One **card per vendor**: status pill, connected/selected project dropdown, and the single primary action
      for the current state (CODESYS: Activate → Select project → Connected; TwinCAT: Open IDE → Select project →
      Connected).
- [ ] Keep the tray icon (aggregate color) + toasts; shrink the context menu to Open Volt · Show logs · Collect
      diagnostics · Exit.
- [ ] Consistent status vocabulary across vendors (Activate needed · Waiting for project · Connected to X ·
      Degraded).

## 4. Cleanup
- [ ] Fix the stale "HTTP wire" language in `Connector/README.md` (data + health wire is named pipes; only the
      `:8550` control plane is HTTP).
- [ ] Implement **"Collect diagnostics"** (bundle logs + `health` + versions to a zip for support) — the README
      already advertises it.
- [ ] Resolve the "config JSON next to the exe later" TODO — a minimal config file or drop the note.
- [ ] Update `Connector/README.md` + `ARCHITECTURE.md` to the new CODESYS activation model + the branded surface.

## 5. Tests
- [ ] Unit: `instances` enumeration + `/select` retarget for both vendors (against the fake IDE / pipe transport).
- [ ] The activation command the connector copies actually loads the host in a live/headless CODESYS (extends the
      `codesys-pipe` smoke).
- [ ] Live parity: TwinCAT + CODESYS both reach "connected to <project>" via detect → pick, no launch step.
