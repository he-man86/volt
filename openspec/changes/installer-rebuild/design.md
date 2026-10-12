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
60 min, then abort, relaunch the still-installed connector, and the next update check retries; (3) log mirror. The UNINSTALLER follows the same rule: it stops Volt's own processes by name and waits for a
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
binaries unchanged, connector relaunched → 5 same, then stop the console 5 s into the wait: setup completes, assert
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
