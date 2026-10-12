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

- [x] 1.1 `test:install` rewritten against the design: hard checks for the shortcut, Run key value, exact PATH entry
      (and `ChangesEnvironment` broadcast observable to a new process), Documents scripts, `desktop\VoltDesktop.exe`,
      the bridge DLL found without `VOLT_BRIDGE_DLL`; an upgrade run from today's installer (`--older`, the last released
      build); a run with a `volt.exe` process alive during a silent update (not killed, update waits/retries); a tampered
      download refused by the updater. Red against today's installer where the design changes behaviour.

      **Done 2026-10-12.** `scripts/test-install.ts` rewritten from the design (no `warn`; `--older <setup|stable>`
      REQUIRED — absent, missing, or not older than the new build → refused by name, checked; refuses a machine where
      Volt is already installed or `{app}` is on PATH, and — so no leftover passes an assertion the installer did not
      earn — where a Volt process runs (a dev tray publishes its own Documents scripts), `Volt.lnk`, the Run value, a
      Documents\Volt script or a retired env var already exists). Flow 1–10 as design 1. Contract the build steps must meet:
      oracle = Add/Remove `DisplayVersion` == the setup's ProductVersion == FileVersion of the 6 stamped binaries
      (`connector\VoltConnector.exe`, `connector\VoltBridgeTwincat.exe`, `connector\Volt.Engine.Host.dll`,
      `bin\volt.exe`, `desktop\VoltDesktop.exe`, `codesys\Volt.Ide.Codesys.dll`) + `volt-lsp-iec --version`;
      `bin\` = exactly `volt.exe` + `volt-lsp-iec.exe`; no `app-*`, `current`, `.vsix`; PATH `{app}\bin` once,
      nothing else under `{app}`, every other entry byte-identical, and after uninstall the PATH equals the run's
      starting PATH; `Volt.lnk` → `desktop\VoltDesktop.exe`; Run `VoltConnector` = `"{app}\connector\VoltConnector.exe" --silent`;
      `VOLT_BRIDGE_DLL`/`OPENCODE_CONFIG_DIR` absent; the tray runs FROM `{app}\connector\VoltConnector.exe` (matched by
      executable path, never image name); then (polled — the connector publishes them at startup) Documents\Volt holds
      both scripts byte-identical to `{app}\codesys\` (gone after uninstall); the
      installed script's `_INSTALL_SUBDIR` + `Volt.Ide.Codesys.dll` exists; the broadcast seen by a hidden top-level
      window (prototyped: a `SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, "Environment")` is recorded) on
      every install AND uninstall; mirrored logs carry `volt: install ` / `volt: uninstall` and no
      WARNING/FAILED/MISSING; step 4 = setup non-zero, CLI pid alive, NTFS file ids of the binaries unchanged
      (`fsutil file queryfileid` — Inno restores timestamps, so mtime cannot tell; an unreadable id fails by name),
      connector relaunched from `{app}`, the mirrored install log carries `volt: gave up waiting for volt.exe`; step 5
      = its log carries `volt: waiting for volt.exe` and not the give-up line; step 6 = uninstaller exit non-zero and
      its mirrored log carries `volt: gave up waiting for volt.exe`; the CLI is held by `volt console --port <n>
      --no-open` (no browser tab); every setup has a timeout (600 s, 300 s for the CLI steps), is failed by name past
      it and killed with its process tree (Inno's `is-*.tmp` child), and an uninstaller second phase (`_iu*.tmp`)
      alive after 120 s is failed and killed. Step 10 runs `dotnet test … --filter UpdaterVerificationTests` and refuses 0 tests.
      Tampered download (test-first): `Updater.cs` MOVED to `Volt.Connector.Core` (unchanged behaviour; the
      net10.0 test project cannot reference the net10.0-windows shell; `InternalsVisibleTo VoltConnector`) and
      takes its feed + installed version as parameters (`CheckOnce(feed, installed)`, production passes
      `GitHubFeed`, `CurrentVersion`). `UpdaterVerificationTests` serves a localhost release: no digest → refused,
      mismatching digest → refused (both: `DownloadPendingAsync` returns null, a log line names the version and
      "digest", no file left in %TEMP%), matching digest → the exact bytes (positive control, last — the static
      `_applying` stays set after a success). **Red today:** 1 failed ("a release with NO digest was downloaded for
      launch"), Volt.Connector.Tests otherwise 115/115.
      **Red against today's installer** (static, from `installer/Volt.iss` and `dist/stage` of build 09:15 =
      0.1.17562; the live run was NOT made in this step: the installed connector spawns a worker for every open XAE
      and today's installer `taskkill`s `VoltBridgeTwincat`/`volt` by name, and another workflow's TcXaeShell +
      CODESYS were running — 3.1 runs it live): steps 2/3/5/8 fail on `desktop\VoltDesktop.exe` (missing — and
      today's desktop exe carries FileVersion `0.1.0`, the package.json base, not the build: renaming it alone stays
      red, 2.1 stamps it), `connector\*`,
      `codesys\*`, `{app}\bin` (payload under `app-<v>\`), `app-*` + `current` present, `.vsix` present, PATH =
      `{app}\current\bin`, `VOLT_BRIDGE_DLL` set, Run value names `app-<v>\VoltConnector.exe`, shortcut →
      `current\desktop\Volt.exe`, no broadcast (no `ChangesEnvironment`), `_INSTALL_SUBDIR` =
      `Programs\Volt\codesys-scriptcommands` (does not exist); steps 4–6 fail by name (`{app}\bin\volt.exe`
      missing — and `PrepareToInstall` kills `volt.exe`; no `volt: waiting for` / `gave up waiting for volt.exe`
      line exists in today's `[Code]`); steps 7/9 fail on the broadcast and the `volt: uninstall`
      marker; step 10 fails as above. `promote.yml` still calls the gate without `--older` (refused) until 2.5.

      **Gate 1 review (2026-10-12), all six fixed:** (a) log evidence is now the bytes THIS step appended
      (`logMark` = every log-store file's size before the setup/uninstaller, `logSince` reads past it; a per-run file
      reads whole) — the uninstaller appends a whole day to one `uninstall-<date>.log` (today's: 6 uninstalls, 24
      lines, none with `volt:`); a probe on a copy of it: the old reader gave step 7 step 6's `volt: uninstall` and
      FAILED line, the new one neither. Every uninstall-log line must carry `volt:` (the WARNING/FAILED/MISSING
      filter never saw `[uninstall] <msg>`) — 2.2's ULog writes the prefix. (b) a `volt.exe` from ANY path at start
      is refused naming pid + path (every setup would wait on it for the default hour); a setup timeout names any
      running `volt.exe`. (c) step 4's "connector relaunched" = a pid from `{app}\connector\VoltConnector.exe` that
      was not running before the setup (none before → failed by name). (d) step 6 also requires all stamped
      binaries, `volt-lsp-iec.exe`, `{app}\codesys\*.py`, Documents\Volt's scripts and the tray running from
      `{app}` after the abort. (e) design 1 + installer/README.md corrected: the gate asserts the markers it lists,
      in order, in what each step appended (today one opening marker + the wait lines; 2.2 sets the per-action list
      and the gate lists it); the gate refuses to start beside a Volt process / `volt.exe` (it stops nothing).
      (f) step 10's dotnet is chosen by `--list-sdks` (the first of `C:\Program Files\dotnet`, then `where dotnet`,
      with a 10.x SDK) at START, refused by name when none has one (measured: machine-wide 8.0.418 + 10.0.401 →
      chosen; x86 dotnet has none). Numbers: `bun run typecheck` green (4 packages), `scripts/` tsc green, `bun run
      lint` exit 0 (`test-install.ts` no findings), `bun run check` green, `Volt.Connector` builds;
      `Volt.Connector.Tests` 115/116 — the 1 red is 1.1's red-first `UpdaterVerificationTests`
      (no-digest download accepted), turned green by 2.3. The gate itself is not run live here (3.1).

## 2. Build

- [ ] 2.1 Payload: flat layout, single-file `volt.exe`, one .NET runtime for connector + worker, `SatelliteResourceLanguages=en`,
      no PDBs, Electron `electronLanguages: [en-US]`, `VoltDesktop.exe` STAMPED with the full release version
      (electron-builder `buildVersion` = `VOLT_VERSION` → its FileVersion; today it reads the package.json base
      `0.1.0` while every C# binary reads `0.1.<count>` — the gate's `stamped` list holds it); `build-payload.ts` /
      `build-installer.ts` / `build-cli.ps1` rewritten to it (the `.vsix` gone). Size measured against 0.1.
- [ ] 2.2 `installer/Volt.iss` written new: declarative sections, the minimal `[Code]`, the one-release upgrade step;
      the `/VOLTWAIT` wait on a running `volt.exe` (setup AND uninstaller) logs `volt: waiting for volt.exe` when it
      starts and `volt: gave up waiting for volt.exe` when it runs out (the gate's steps 4–6 read those exact lines).
      Every uninstall-log line carries `volt:` (the gate refuses an unprefixed one); an aborted uninstall leaves
      every file in place and the tray running from `{app}` (step 6); the per-action `volt:` marker list is set here
      and listed in the gate's `assertLog` calls (installer/README.md's list rewritten in 3.2).
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
