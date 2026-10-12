# Design — installer-rebuild

## 0. Requirements and design (measured 2026-10-12, `dist/stage` of build 09:15)

Units: MiB (2^20, Explorer's) unless marked "MB" (10^6). Re-measure with `bun scripts/measure-payload.ts` (same
buckets before and after; 2.1 runs it on the new stage).

**Today:** installer 208.4 MB = 198.8 MiB (LZMA), 650.9 MiB / 569 files unpacked: `desktop\` 369.3 MiB (Electron exe 234.9; `locales\` 48.3, en-US 0.6;
`LICENSES.chromium.html` 19.5), `bin\` 161.0 MiB / 199 files on PATH (`volt-lsp-iec.exe` 83.1 + 77.8 / 198 files of
self-contained runtime for `volt.exe`, its 4 PDBs 0.16 included), connector + worker 118.9 MiB / 289 files (the stage
root: the two already share ONE runtime; includes all 52 satellite DLLs, 8.5 MiB in 13 locales), 12 PDBs 0.4 MiB (4 in
`bin\`, 8 at the root 0.25), `.vsix` 0.4 MiB, `codesys-scriptcommands\` 1.7 MiB. The script's buckets are by role
(connector = stage root today, `connector\` after; Electron exe = the largest `desktop\*.exe`) and it refuses an
unclaimed file or an empty required lever, so the 2.1 rows line up with these.

**Checklist (keep → where; drop → what it served):** KEEP per-user no-admin install → `[Setup]`; `volt`+`volt-lsp-iec`
on PATH → `[Registry]` exact entry, `ChangesEnvironment=yes`; Start Menu "Volt" → `[Icons]`; login item (Run
`VoltConnector` = `"…\connector\VoltConnector.exe" --silent`) → `[Registry] uninsdeletevalue`; Documents\Volt CODESYS
scripts → connector at startup (a dev tray must publish its own copy), `--uninstall` removes them; connector started
after install → `[Run]`; binary version stamp, setup-log mirror → `[Code]`; silent in-place update → `Updater.cs`.
DROP `app-<v>` + `current` junction + Pruner (served the never-finished `versioned-install-dirs`); `RemoveFlatPayload`
(July flat layout); `OPENCODE_CONFIG_DIR` retirement (opencode, gone 2026-08-05); `VOLT_BRIDGE_DLL` user env (stale
flat-era script fallback); connector-written shortcut + Run key (Velopack era); `.vsix` sideload + editor tasks
(`vscode-extension-marketplace`); substring PATH strip (`\programs\volt`); `VoltEnv.Uninstall`'s process kill (names
`VoltConnector` + `Volt.Cli.Beckhoff` — the worker has been `VoltBridgeTwincat` since the toolchain merge, so that half
kills nothing; the uninstaller's own stop covers both); the connector's uninstall-time Run-key/shortcut removal (both
become Inno-declared).

**Target layout** `%LOCALAPPDATA%\Programs\Volt\`: `bin\volt.exe` (single-file, self-contained, uncompressed) +
`bin\volt-lsp-iec.exe` — nothing else; `desktop\VoltDesktop.exe` (`productName` stays `Volt`); `connector\`
(VoltConnector + VoltBridgeTwincat, one runtime, `SatelliteResourceLanguages=en`, no PDBs); `codesys\` (bridge DLL +
start/stop scripts; `start_volt_codesys.py` finds the DLL beside itself, else `…\Programs\Volt\codesys\`, env var dev-only).
- Single-file `volt.exe` measured 71.0 MiB / 74.4 MB, one file (vs 77.8 MiB / 198 files); `--version` runs. Rejected: `EnableCompressionInSingleFile` (36.1 MiB / 37.9 MB on disk, re-measured 2026-10-12,
  but the installer is LZMA anyway and every agent-driven CLI call pays the decompression); trimming / NativeAOT
  (`Volt.Engine`/`Wire`/`Contracts` multi-target net48 — publish fails NETSDK1124 — and use reflection JSON); one shared
  dotnet root via `AppHostRelativeDotNet` (~75 MiB less, an estimate from the 77.8 MiB `bin\` runtime, not measured; but `volt.exe` stops being a standalone copyable exe and the build
  must assemble a dotnet root).
- Electron `electronLanguages: [en-US]` (−47.7 MiB). Chromium licence file stays (its notices are required). Rejected
  here: a WebView2 shell (up to −369.3 MiB, all of `desktop\`, but a desktop rewrite, not an installer change — the next size lever, recorded).

**Inno:** `[Setup] CloseApplications=no` (Restart Manager would close the CLI — rejected), `[Files]`, `[Icons]`,
`[Registry]`, `[UninstallDelete]`, `[Run]` connector `--silent`. `[Code]` only: (1) `taskkill /IM` VoltConnector,
VoltBridgeTwincat, VoltDesktop, volt-lsp-iec — unique names now (an editor restarts its LSP; waiting on it would never
end); (2) a running `volt.exe` is NEVER killed: interactive → Retry/Cancel page naming it; silent → poll every 2 s up to
60 min, then abort (nothing stopped yet), start the still-installed connector if none runs, and the next update check retries; (3) log mirror. The UNINSTALLER follows the same rule: it stops Volt's own processes by name and waits for a
running `volt.exe` (interactive Retry/Cancel; silent uninstall aborts after the same timeout) — today it kills it.
`[Setup]` keeps the stable `AppId`, `CloseApplications=no`, `SetupLogging=yes`; `UninstallDisplayIcon` names
`desktop\VoltDesktop.exe`.

**Verified update:** `Updater.cs` takes the asset's `digest` (`sha256:…`) from the GitHub releases API it already calls
(present on every published release asset — checked 2026-10-12, 0.1.16883 … 0.1.17512, stable 0.1.16986; the 9
drafts carry no assets) and runs the download only on a match; a mismatch or a missing
digest is refused by name. Rejected: a `.sha256` sidecar from `release.yml` — same origin, one more asset and step.

**Migration (one release, then deleted):** stop today's desktop by PATH (`app-*\desktop\Volt.exe` shares the CLI's image
name), wait for an old CLI as above, remove `app-*` + `current`, `VOLT_BRIDGE_DLL`, `OPENCODE_CONFIG_DIR`, the old PATH
entry exactly, the connector-written Run value + `Volt.lnk`; uninstall keeps `--uninstall-extension` lines one release.

**Refused by name:** junction/versioned dirs, killing `volt.exe`, any install-time write by the connector, any env var
besides PATH, writing into another vendor's config, a sideloaded extension, an unverified download. Projected unpacked
≈ 587.1 MiB (−63.8 MiB: locales −47.7, CLI −6.9 — 77.8 → 71.0, its 4 PDBs included —, satellites −8.5, the 8
connector-side PDBs −0.25, `.vsix` −0.4; each MiB counted once), measured for real in 2.1.

## 1. Gate first (red) — `test:install` against the target

**Target:** one script, `scripts/test-install.ts`, every check HARD (`warn` deleted). Oracle for "what version is
installed" = the Add/Remove `DisplayVersion` Inno writes (the `app-<v>` dir name is gone); every stamped binary
(`connector\VoltConnector.exe`, `connector\VoltBridgeTwincat.exe`, `connector\Volt.Engine.Host.dll`, `bin\volt.exe`,
`desktop\VoltDesktop.exe`, `codesys\Volt.Ide.Codesys.dll`) and `volt-lsp-iec --version` must equal it. Kept: rollback /
"in use … Abort" log detection, the `volt:` markers (in order — today one per run, `volt: install ` / `volt:
uninstall`, plus the wait lines; 2.2 sets the per-action list and the gate's `assertLog` lists it), read as the bytes
THIS step appended to the mirrored log (the uninstall log is one file per day), leftover checks, the tray-running check.

**Hard after every install:** `Volt.lnk` exists and targets `desktop\VoltDesktop.exe` (WScript.Shell); Run value
`VoltConnector` == `"<app>\connector\VoltConnector.exe" --silent` exactly; user PATH has `<app>\bin` exactly once and no
other `<app>`-prefixed entry; Documents\Volt holds both CODESYS scripts; `VOLT_BRIDGE_DLL`/`OPENCODE_CONFIG_DIR` absent;
no `current`, no `app-*`, no `.vsix`; the bridge DLL resolves without the env var — the gate reads `_INSTALL_SUBDIR` from
the installed Documents script and requires `Volt.Ide.Codesys.dll` there (live proof stays 2.4's CODESYS e2e).
Broadcast: before each setup the gate starts a hidden top-level window (PowerShell `Add-Type`) and requires a
`WM_SETTINGCHANGE` with `"Environment"` before setup exits. Rejected: grepping the Inno log (proves intent, not
delivery); launching a probe through Explorer (needs an interactive shell; a CI session has none to rely on).

**Flow:** 1 install `--older` (today's layout) → 2 update to new (+ migration: no `app-*`/`current`, old PATH entry,
env vars, old Run value gone) → 3 update again (same build, files in use) → 4 CLI alive: start `bin\volt.exe console
--port <free>` (a real verb, no hook), run setup with `/VOLTWAIT=15`; it must exit non-zero, `volt.exe` still alive,
binaries unchanged, nothing stopped (the tray's pids unchanged) → 5 same, then stop the console 5 s into the wait: setup completes, assert
installed → 6 uninstall with the console alive + `/VOLTWAIT=15`: aborts, nothing removed → 7 uninstall → clean →
8 fresh install of new → 9 uninstall → clean. `/VOLTWAIT=<s>` is an Inno `{param:}` (default 3600) so the abort
branch is gated in seconds; rejected: an env var (refused — PATH only) and leaving the abort untested.
**Tampered download:** `Updater` takes its feed URL as a parameter (internal); `Volt.Connector.Tests` serves a
localhost release whose asset `digest` mismatches (and one with none) and asserts refusal by name and no launch;
`test:install` runs that filter as its step 10 so the gate reports it. Rejected: a hidden connector verb (a test hook
in the shipped exe); a `VOLT_UPDATE_FEED` env + clicking the tray (UI automation).

**`--older` is required** — a setup path, or `stable` = `gh release download <latest non-prerelease> -p
Volt-win-Setup.exe`; absent → refused by name ("no upgrade source"). `promote.yml` passes `--older stable`.

**Refused by name:** a soft check; a run without an upgrade; killing `volt.exe` in any step; a test-only verb in a
shipped binary. **Red today:** no `desktop\VoltDesktop.exe`, `app-*`/`current` present, `VOLT_BRIDGE_DLL` set, the CLI
killed in step 4. **Migration:** the extension checks go (the extension leaves the installer); `restoreExtensionBaseline`
reinstalls from the Marketplace id while uninstall still runs `--uninstall-extension`, and is deleted with those lines.

## 2. Build — payload, Volt.iss, connector cut, verified update, start script, leftovers

**Target:** `dist/stage` IS the installed tree (`bin\`, `desktop\`, `connector\`, `codesys\`) — `{app}` copies it 1:1,
so `[Files]` is four `recursesubdirs` lines and the stage, the gate and `installer/README.md` name the same paths.

- **Payload.** `build-cli.ps1`: `volt.exe` `PublishSingleFile` (+`SatelliteResourceLanguages=en`, `DebugType=none`
  on every publish); connector + worker publish into ONE `connector\` — measured: the 202 files both bundles carry
  are byte-identical (0 differ), so an overlay is one runtime; the script refuses an overlap whose bytes differ, by
  name. `codesys\` = the DLL + two scripts (no copy under the connector). `build-installer.ts`: electron-builder
  `executableName: VoltDesktop`, `electronLanguages: [en-US]`, `-c.buildVersion=$VOLT_VERSION` (FileVersion = the
  build, not `0.1.0`; `productName` stays `Volt`). Deleted, not kept: `build-payload.ts`'s "reused the prior
  bundle" and "ships without the extension" branches (fallbacks that hid a failed build) and the `.vsix` step.
  Rejected: an MSBuild target that merges the worker into the connector project (two TFMs' worth of glue for an
  overlay already proven identical).
- **Volt.iss, written new.** `[Files]` (above), `[Icons]` `{userprograms}\Volt` → `desktop\VoltDesktop.exe`,
  `[Registry]` Run `VoltConnector` `uninsdeletevalue`, `[UninstallDelete]` the two `{userdocs}\Volt\*.py` +
  `dirifempty`, `[Run]` connector `--silent nowait`. PATH is NOT `[Registry]`: an `uninsdeletevalue` on `Path`
  deletes the user's whole PATH — `[Code]` adds/removes the exact `{app}\bin` entry; `ChangesEnvironment=yes`
  broadcasts on install and uninstall. Processes in `[Code]` through ONE mechanism, WMI
  (`WbemScripting.SWbemLocator`, `Win32_Process.ExecutablePath`): stop = terminate every process whose path is under
  `{app}` and is not `bin\volt.exe`; wait = a `volt.exe` under `{app}` (today's `app-*\bin` and `current\bin`
  included) → interactive Retry/Cancel naming its pid, silent → poll 2 s up to `{param:VOLTWAIT|3600}`, logging
  `volt: waiting for volt.exe` / `volt: gave up waiting for volt.exe`. Path-scoped, so a dev tray or a `volt.exe`
  running from the repo is neither killed nor waited on, and today's desktop (`app-*\desktop\Volt.exe`, the CLI's
  image name) is stopped by its path. Rejected: `taskkill /IM` (no path — cannot tell old desktop from CLI, kills
  dev builds); `tasklist`/PowerShell exec (no path / a process spawn plus execution policy per poll). Every
  uninstall-log line goes through `ULog` (`volt:` prefix); per action: `volt: install <v>`, `volt: migrate <what>`,
  `volt: uninstall`, the two wait lines.
- **Connector cut.** Delete `LoginItem.cs`, `Pruner.cs`, `--uninstall` (the two Documents files are Inno's
  `[UninstallDelete]` — a verb that only deletes two named files is not worth shipping), `VoltEnv`'s shortcut,
  Run-key, env and kill code, and `claimTheMachine`/the `Updater.IsDev` ordering it guarded. Kept: publishing the
  Documents\Volt scripts at startup (a dev tray publishes its own). `GuiExe` = `..\desktop\VoltDesktop.exe` from
  `connector\`; CODESYS scripts from `..\codesys\`.
- **Verified update** (as 0): `Updater` hashes the download (SHA-256) against the asset's GitHub `digest` and runs it
  only on a match; missing/mismatching → refused by name, file deleted. `release.yml` adds nothing — GitHub computes
  the digest server-side (tasks 2.3's "publishes it" is satisfied by the asset upload). Rejected: a `.sha256` sidecar.
- **Start script.** `_INSTALL_SUBDIR` → `("Programs","Volt","codesys")`; lookup order unchanged (env override for
  `ide.ps1`, beside the script, install dir). The env var is never written by an installer again.
- **Leftovers.** `version.ts` prints one `version=` line; `base`/`vsix`/`prerelease` and `--vsix` go (consumers:
  `release.yml` stamp, volt-vscode `package` script, `test-extension.ts` → `--version`); `--prerelease` arg and
  its no-op comment go; `promote.yml` runs `test:install --older stable`. The local Velopack artifact is listed
  for deletion in 3.2.

**Migration (one release, `[Code]` `ssInstall`, each logged `volt: migrate …`):** stop by path, wait for an old CLI,
`RemoveDir` the `current` junction FIRST (a recursive delete through a junction deletes its target), then `DelTree`
each `app-*`; remove `{app}\current\bin` from PATH exactly, `VOLT_BRIDGE_DLL`, `OPENCODE_CONFIG_DIR`; the old
Run value is overwritten by `[Registry]`, `Volt.lnk` by `[Icons]`.

**Refused by name:** a reused/partial payload, a byte-differing shared runtime, PATH via `[Registry]`, killing by
image name, a connector install-time write or `--uninstall` verb, an undigested download.

**As built (2.1–2.5, 2026-10-12) — where reality refined the above, and why.** Each was measured with a probe that
compiles THIS `Volt.iss` under another AppId/dir/names (PING.EXE copies as the exes, a fake app-0.0.1 + `current`
layout) and installs, updates and uninstalls it: 0 failures, PATH byte-identical afterwards.
- **Wait FIRST, then stop — both directions.** (Built stop-then-wait in setup first; step-2 review: StopOwn stops
  `connector\VoltBridgeTwincat.exe`, the other end of the pipe a running `volt push` writes a live TwinCAT project
  through, so the push was cut mid-write while `volt.exe` was spared and waited on — measured on the probe: old order
  logged `stopped … VoltBridgeTwincat.exe` before `waiting for volt.exe`, worker dead after exit 7; new order: worker
  and tray alive, nothing stopped.) Setup (PrepareToInstall): wait → on give-up exit 7, nothing stopped; else stop →
  on failure refuse by name. The uninstaller (InitializeUninstall): wait → abort = exit 1; then stop → a failure
  ABORTS too (it used to stop at `usUninstall` and ignore the result, removing part of `{app}` and reporting
  success); a stopped tray comes back if the user then declines (DeinitializeUninstall). `RelaunchConnector` starts
  the tray only when none runs from `{app}` (the auto-update's tray has exited before its setup runs); the gate's
  step 4 asserts the SAME tray pids, no `volt: stopped` line, and step 5 the stop AFTER the wait. The auto-update's
  tray (TrayContext.ApplyUpdate) also waits for a running `{app}\bin\volt.exe` before it disposes the worker fleet.
- **The CLI is found by NAME, its path read the way an elevated one allows, and an unreadable one is waited on**
  (gate-2 review 2). WMI's `ExecutablePath` is null — and .NET's `MainModule` empty — for an ELEVATED process of the
  same user (a `volt.exe` from an admin terminal), so both waits missed it and the stop cut its push. `FindCli` queries
  `WHERE Name = 'volt.exe'` and resolves a null path with `QueryFullProcessImageName` (PROCESS_QUERY_LIMITED_INFORMATION
  reads those); a `volt.exe` whose path even that refuses counts as the CLI (fail closed: a stranger costs an
  update, a cut push costs a PLC project). The tray's wait is the same rule (`Volt.Connector.Core/CliProcess.cs`).
  Rejected: skipping an unreadable process (what both did), elevating setup (a per-user install).
- **A CLI that starts during the stop sends it back to the wait.** Every StopOwn round looks for a CLI first and on
  finding one stops nothing more (`volt: volt.exe started … back to waiting for it`); the tray takes its last look
  with the timer stopped, right before it disposes the fleet. StopOwn's 30 s is wall clock (60 counted rounds measured
  44–51 s). Rejected: one look before the stop (the check-then-act window the review measured).
- **Every setup that reached PrepareToInstall ends by relaunching the tray when none runs** (DeinitializeSetup), not
  only the two refusal paths: a stop followed by an abort (a locked file in `[Files]`, a rollback) left no tray and no
  TwinCAT worker until the next login. After a completed install `[Run]` has started it and the relaunch is a no-op
  (`volt: the connector is running - nothing to relaunch`).
- **PATH round trip is exact** (step-2 review, probe red on 4 of 7 shapes): the remove splits the value into its
  exact parts (a trailing `;` is an empty last part) and keeps the rest; the add writes `X;Dir`, or `X;Dir;` when the
  value is empty or ends in `;`; a value that held only `Dir` (none before the add) is deleted; an existing value's
  type is kept (RegWriteStringValue — REG_SZ stays literal). Probed on plain, trailing `;`, REG_SZ with `%…%`, `;;`
  inside, trailing `;;`, empty and absent: all byte- and type-identical after install → uninstall.
- **The WMI query is filtered by WMI** (`WHERE ExecutablePath LIKE '<app>\%'`, LIKE wildcards escaped): reading
  every process's properties through IDispatch measured ~20 s per scan in the uninstaller. The wait limit is wall
  clock (`GetTickCount`), not a sum of sleeps — the scans take time of their own (a 6 s limit waited 72 s).
- **Not `{app}` itself**: only processes in a FOLDER under `{app}` are stopped. The uninstaller's first phase
  (`{app}\unins000.exe`) waits there for its second; stopping it ended the uninstall with exit 0 (measured).
- **`UninstallLogMode=overwrite`** + `[UninstallDelete]` of the four folders whole: appending (the default) carries
  the app-era entries forward, among them an `[UninstallRun]` of `{app}\current\VoltConnector.exe --uninstall`, an
  exe the upgrade deletes; files a later build drops still go. `DisableDirPage=yes`: the Documents copy of the start
  script finds the DLL at the FIXED path.
- **Migration**: the stop + CLI wait is the one in PrepareToInstall (path-scoped, so it covers `app-*`/`current`
  too); `ssInstall` only removes (junction, `app-*`, PATH entry, the two env vars), each logged `volt: migrate removed …`.
- **Markers, per action** (build-installer.ts refuses a build without them; the gate's assertLog lists them in
  order): install `volt: install <v>` → `volt: stopped <n> …` → (`volt: migrate removed …`) → `volt: PATH carries`;
  uninstall `volt: uninstall <v>` → `volt: stopped <n> …` → `volt: PATH no longer carries`; plus
  `volt: waiting for volt.exe` / `volt: gave up waiting for volt.exe` / `volt: relaunched the connector`.
- **The one-runtime overlay is NOT all byte-identical** (the 0 measurement compared the stage AFTER the old
  `Copy-Item -Force` overlay). Of 189 shared files the refusal named 3: `Volt.Contracts.dll` (a build between the two
  publishes; fixed by publishing them back to back and `DebugType=none` on every line, the Codesys build included)
  and the connector's `Microsoft.VisualBasic.dll` / `System.Drawing.dll` — the WinForms app's
  Microsoft.WindowsDesktop.App facades, which supersede NETCore's and which the worker never references. Those are
  the one exception, read from the connector's deps.json (that pack's file list), the connector's copy kept; any other
  difference is still refused by name.
- **build-cli.ps1** states the lean flags on each publish line, not through a variable: `BridgePackagingTests`
  replays each line verbatim (it expands only `@VERARGS`).
- **release.yml** adds one check — the published asset carries a `sha256:` digest (`gh api …/releases/tags/<v>`),
  since an asset without one is an update every connector refuses. `version.ts --vsix` became `--version`.
- **2.4's live proof**: `ide.ps1 up -Vendor codesys -BridgeDir <dist\stage\codesys>` serves the bridge AS INSTALLED
  — that folder's own start script (`VOLT_START_SCRIPT`, run with its own `__file__`), `VOLT_BRIDGE_DLL` removed —
  and the Documents-copy case is `StartScriptLoadTests` (IronPython, `%LOCALAPPDATA%` redirected), red on the old
  `_INSTALL_SUBDIR`.
