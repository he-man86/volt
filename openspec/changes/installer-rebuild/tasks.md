## 0. Requirements and design

- [ ] 0.1 The requirements checklist: every behaviour the current installer and connector install-side provide, from
      the 2026-10-12 audit (proposal), each marked keep (and where it lives in the new design) or drop (with the deleted
      thing it served). Measure today's payload per component (`dist/stage`, uncompressed, and the installer size).
- [ ] 0.2 design.md: the target from the ground up — layout, Inno sections, the `[Code]` that remains, process handling
      (stop own processes by their own names; wait for a running CLI, never kill it), the update verification, the
      one-release upgrade from today's layout, the size levers. Every choice states the lean alternative it beat.

## 1. Gate first (red)

- [ ] 1.1 `test:install` rewritten against the design: hard checks for the shortcut, Run key value, exact PATH entry
      (and `ChangesEnvironment` broadcast observable to a new process), Documents scripts, `desktop\VoltDesktop.exe`,
      the bridge DLL found without `VOLT_BRIDGE_DLL`; an upgrade run from today's installer (`--older`, the last released
      build); a run with a `volt.exe` process alive during a silent update (not killed, update waits/retries); a tampered
      download refused by the updater. Red against today's installer where the design changes behaviour.

## 2. Build

- [ ] 2.1 Payload: flat layout, single-file `volt.exe`, one .NET runtime for connector + worker, `SatelliteResourceLanguages=en`,
      no PDBs, Electron `electronLanguages: [en-US]`, `VoltDesktop.exe`; `build-payload.ts` / `build-installer.ts` /
      `build-cli.ps1` rewritten to it (the `.vsix` gone). Size measured against 0.1.
- [ ] 2.2 `installer/Volt.iss` written new: declarative sections, the minimal `[Code]`, the one-release upgrade step.
- [ ] 2.3 Connector: no install-time writes (shortcut, Run key, env); Pruner and the junction code deleted;
      `--uninstall` reduced; `Updater.cs` verifies SHA-256 before running the download; `release.yml` publishes it.
- [ ] 2.4 `start_volt_codesys.py`: the DLL beside the script or at the fixed install path; `VOLT_BRIDGE_DLL` only as the
      dev override. CODESYS bridge e2e (SP21) green through the shipped start script from an installed layout.
- [ ] 2.5 `promote.yml` gates `--older <current stable>`; `version.ts` / `release.yml` leftovers (`--prerelease` no-op,
      `base`/`vsix` outputs) removed; the stale local Velopack artifact noted for deletion.

## 3. Verify and close

- [ ] 3.1 `build:installer` + the new `test:install` green on this machine (install, update ×N, upgrade from today's
      build, CLI-alive update, tampered download, uninstall leaves nothing); desktop opens; tray starts at login.
- [ ] 3.2 Docs: `installer/README.md` "every location" table from the new installer, `scripts/README.md`, CLAUDE.md.
- [ ] 3.3 Archive. Committed, NOT pushed or released (owner away); the follow-up release deletes the one-release
      upgrade step and the `--uninstall-extension` lines.
