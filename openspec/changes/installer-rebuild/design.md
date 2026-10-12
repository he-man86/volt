# Design — installer-rebuild

## 0. Requirements and design (measured 2026-10-12, `dist/stage` of build 09:15)

**Today:** installer 208 MB (LZMA), 653 MB unpacked: `desktop\` 370 MB (Electron; `locales\` 49 MB, en-US is 0.6 MB;
`LICENSES.chromium.html` 20 MB), `bin\` 162 MB / 199 files on PATH (`volt-lsp-iec.exe` 84 MB + a 77 MB self-contained
runtime for `volt.exe`), root 111 MB (connector + TwinCAT worker already share ONE runtime), 52 satellite DLLs 8.6 MB,
12 PDBs 0.45 MB, `.vsix` 0.4 MB, `codesys-scriptcommands\` 2 MB.

**Checklist (keep → where; drop → what it served):** KEEP per-user no-admin install → `[Setup]`; `volt`+`volt-lsp-iec`
on PATH → `[Registry]` exact entry, `ChangesEnvironment=yes`; Start Menu "Volt" → `[Icons]`; login item (Run
`VoltConnector` = `"…\connector\VoltConnector.exe" --silent`) → `[Registry] uninsdeletevalue`; Documents\Volt CODESYS
scripts → connector at startup (a dev tray must publish its own copy), `--uninstall` removes them; connector started
after install → `[Run]`; binary version stamp, setup-log mirror → `[Code]`; silent in-place update → `Updater.cs`.
DROP `app-<v>` + `current` junction + Pruner (served the never-finished `versioned-install-dirs`); `RemoveFlatPayload`
(July flat layout); `OPENCODE_CONFIG_DIR` retirement (opencode, gone 2026-08-05); `VOLT_BRIDGE_DLL` user env (stale
flat-era script fallback); connector-written shortcut + Run key (Velopack era); `.vsix` sideload + editor tasks
(`vscode-extension-marketplace`); substring PATH strip (`\programs\volt`).

**Target layout** `%LOCALAPPDATA%\Programs\Volt\`: `bin\volt.exe` (single-file, self-contained, uncompressed) +
`bin\volt-lsp-iec.exe` — nothing else; `desktop\VoltDesktop.exe` (`productName` stays `Volt`); `connector\`
(VoltConnector + VoltBridgeTwincat, one runtime, `SatelliteResourceLanguages=en`, no PDBs); `codesys\` (bridge DLL +
start/stop scripts; `start_volt_codesys.py` finds the DLL beside itself, else `…\Programs\Volt\codesys\`, env var dev-only).
- Single-file `volt.exe` measured 74 MB (vs 77 MB + 199 files). Rejected: `EnableCompressionInSingleFile` (38 MB on disk,
  but the installer is LZMA anyway and every agent-driven CLI call pays the decompression); trimming / NativeAOT
  (`Volt.Engine`/`Wire`/`Contracts` multi-target net48 — publish fails NETSDK1124 — and use reflection JSON); one shared
  dotnet root via `AppHostRelativeDotNet` (~75 MB less, but `volt.exe` stops being a standalone copyable exe and the build
  must assemble a dotnet root).
- Electron `electronLanguages: [en-US]` (−48 MB). Chromium licence file stays (its notices are required). Rejected
  here: a WebView2 shell (−370 MB, but a desktop rewrite, not an installer change — the next size lever, recorded).

**Inno:** `[Setup] CloseApplications=no` (Restart Manager would close the CLI — rejected), `[Files]`, `[Icons]`,
`[Registry]`, `[UninstallDelete]`, `[Run]` connector `--silent`. `[Code]` only: (1) `taskkill /IM` VoltConnector,
VoltBridgeTwincat, VoltDesktop, volt-lsp-iec — unique names now (an editor restarts its LSP; waiting on it would never
end); (2) a running `volt.exe` is NEVER killed: interactive → Retry/Cancel page naming it; silent → poll every 2 s up to
60 min, then abort, relaunch the still-installed connector, and the next update check retries; (3) log mirror.

**Verified update:** `Updater.cs` takes the asset's `digest` (`sha256:…`) from the GitHub releases API it already calls
(present on every release asset, checked 0.1.17512) and runs the download only on a match; a mismatch or a missing
digest is refused by name. Rejected: a `.sha256` sidecar from `release.yml` — same origin, one more asset and step.

**Migration (one release, then deleted):** stop today's desktop by PATH (`app-*\desktop\Volt.exe` shares the CLI's image
name), wait for an old CLI as above, remove `app-*` + `current`, `VOLT_BRIDGE_DLL`, `OPENCODE_CONFIG_DIR`, the old PATH
entry exactly, the connector-written Run value + `Volt.lnk`; uninstall keeps `--uninstall-extension` lines one release.

**Refused by name:** junction/versioned dirs, killing `volt.exe`, any install-time write by the connector, any env var
besides PATH, writing into another vendor's config, a sideloaded extension, an unverified download. Projected unpacked
≈ 590 MB (−63 MB), measured for real in 2.1.
