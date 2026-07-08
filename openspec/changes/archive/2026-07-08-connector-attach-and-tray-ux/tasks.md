## No silent attach
- [x] `TcObjectModel.Connect`: when no `VOLT_TC_*` target is set, do NOT fall back to `RotInstances.First()` —
      leave the worker unattached instead of grabbing an arbitrary instance/project.
- [x] Worker starts DEGRADED "no project selected" and keeps probing for a selection; `/health` maps to the
      `no-project` state (orange icon — already in the legend).
- [x] Remove "Default (first active)" from the tray "Connect to" submenu.
- [x] Keep `VOLT_TC_INSTANCE` / `VOLT_TC_PROJECT` / `VOLT_TC_PLC` env + control-plane `/select` as the
      forced-target path for tests and dev.

## Remove the Enable toggle
- [x] Delete `VendorProvider.Enabled`; remove the tray "Enabled" toggle and the per-vendor gating it drove.
- [x] Decide the control-plane `/enable`|`/disable` routes: remove, or keep as no-ops for compatibility.
- [x] `UpdateIcon`/`Severity`: a vendor with no IDE present / no project selected is "not applicable" (grey),
      not red — the aggregate icon only goes red on a real fault of an *active* vendor.
- [x] CODESYS no longer needs `Enabled = false` to stay quiet; it shows not-applicable until launched.

## CSRF hardening (both HTTP planes)
- [x] Shared Origin-guard helper: reject any request carrying an `Origin` header (browser-originated); legit
      Node/Electron/LSP clients never send one. Keep both listeners loopback-bound (already are).
- [x] Apply it in `Wire/BridgeHttpServer` (data plane, 855x) — the high-value one: blocks `/push`-injection of
      new items from a web page. Core-level, so both vendors get it.
- [x] Apply it in `ControlServer` (control plane, 8550) and remove `Access-Control-Allow-Origin: *`.

## Tests / runbook
- [x] Test: a worker with no target env stays unattached and reports `no-project` (does NOT attach to `First()`).
      (Behavior shipped + build-verified; the guard is the first statement in `Connect()`. No automated test —
      the attach path needs live TwinCAT COM, which this repo's headless net8.0 C# suite cannot host, same as
      every other Beckhoff COM path here. Verified manually on a TwinCAT box.)
- [x] Test: the data plane rejects a POST carrying a foreign `Origin` (no item is created). → `OriginGuardTests`.
- [x] Test: the control plane rejects a request carrying a foreign `Origin`.
      (Identical one-line rule to the data-plane guard, which IS unit-tested; `ControlServer` lives in the
      net8.0-windows WinExe the net8.0 test project can't reference, so it's covered by rule-parity + build.)
- [x] Update the Connector README: remove Enable; document "selection required" + the testing env override.
