## 0. Requirements and design

- [x] 0.1 The requirements checklist: every behaviour the current installer and connector install-side provide, from
      the 2026-10-12 audit (proposal), each marked keep (and where it lives in the new design) or drop (with the deleted
      thing it served). Measure today's payload per component (`dist/stage`, uncompressed, and the installer size).
- [x] 0.2 design.md: the target from the ground up — layout, Inno sections, the `[Code]` that remains, process handling
      (stop own processes by their own names; wait for a running CLI, never kill it), the update verification, the
      one-release upgrade from today's layout, the size levers. Every choice states the lean alternative it beat.

      **Measured 2026-10-12** (`bun scripts/measure-payload.ts`, `dist/stage` of build 09:15; MiB unless "MB"):
      installer 208.4 MB = 198.8 MiB; unpacked 650.9 MiB / 569 files — `desktop\` 369.3 (Electron exe 234.9, `locales\`
      48.3 of which en-US 0.6, `LICENSES.chromium.html` 19.5), `bin\` 161.0 / 199 files (`volt-lsp-iec.exe` 83.1, CLI +
      runtime 77.8 / 198, its 4 PDBs included), connector + worker 118.9 / 289 (one runtime, all 52 satellites 8.5 inside),
      PDBs 0.4 / 12 (4 in `bin\`, 8 connector-side 0.25),
      `.vsix` 0.4, `codesys-scriptcommands\` 1.7. Single-file `volt.exe` (self-contained, uncompressed,
      `SatelliteResourceLanguages=en`, no PDB) publishes to ONE 71.0 MiB file and runs (compressed: 36.1 MiB, rejected). Projected
      after: ≈ 587.1 MiB unpacked (−63.8, each MiB counted once). Every published release asset carries a GitHub `digest` (0.1.16883 … 0.1.17512); the current
      stable for `--older` is 0.1.16986. Findings beyond the proposal: `VoltEnv.Uninstall` kills `Volt.Cli.Beckhoff`
      (a name no process has had since the toolchain merge); the uninstaller also kills `volt.exe` — the design extends
      "never kill the CLI" to uninstall.

      **Gate 0 review (2026-10-12):** (a) `measure-payload.ts` buckets were today's file names — a renamed
      `desktop\VoltDesktop.exe` read `0 files` and exited 0 (reproduced red on a renamed copy of `dist/stage`). Now by
      ROLE (components desktop / bin / connector + worker / codesys, matching both layouts; Electron exe = the largest
      `desktop\*.exe`; satellites = any non-en `<culture>\*.resources.dll`) and it REFUSES (exit 1) an unclaimed file or
      a required lever with 0 files; the levers the rebuild deletes (satellites, PDBs, `.vsix`) are marked and may read 0.
      Verified on a copy re-laid to the target layout (`connector\`, `codesys\`, `VoltDesktop.exe`, an `sv\` satellite):
      same rows, satellite counted; a stray dir + a missing desktop exe → refused by name. (b) PDBs were counted twice
      in the projection (−64 → −63.8). (c) Units: design/proposal sizes all MiB or marked MB; the compressed single-file
      re-measured (37.9 MB = 36.1 MiB). Typecheck green (`scripts/` tsc, `bun run typecheck`), oxlint clean.

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
