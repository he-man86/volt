## Why

The owner (2026-10-12): rebuild the installer — "our app was a lot larger before, so we have a lot of legacy decisions" —
"built from the ground up with the correct lean choices". The installer was shaped while Volt still shipped opencode, an
agent config dir, a gateway console and the Velopack era. Audited 2026-10-12 (read-only, every section against `git log`
for why it was added; dev at 44dd466bad):

- **Two lock mechanisms for one problem.** The `app-<version>` + `current` junction layout (openspec
  `versioned-install-dirs`, 28c2802e3d) was meant to "retire the process-killing stopgap once the new layout proves out";
  it never did (0 of 24 tasks ticked at close-out), and the kill (`PrepareToInstall` taskkill, fa706704d0) stayed. Most of
  the installer's bug history is the junction's: the race (85deee4075), `...\currentin` on PATH, `[Run]` before `current`
  existed, uninstall leftovers, the pruner — and it breaks its own invariant (the Run key records `app-<v>\VoltConnector.exe`).
- **Migrations for installs that no longer exist**, run on every install: `RemoveFlatPayload` (the July flat layout) and
  the `OPENCODE_CONFIG_DIR` retirement (opencode removed 2026-08-05).
- **A name collision that kills live PLC writes:** the desktop exe is `Volt.exe` and the CLI is `volt.exe` — one image
  name to `taskkill` — so an update kills a running `volt push` mid-write (the hazard `TrayContext.CloseDesktopGui` was
  written to avoid).
- **Velopack-era runtime side effects:** the Start Menu shortcut and the login item are written by the connector at
  runtime (the dev-build hijack 1ffdae1599, the `Updater.IsDev` ordering bug), not declared in Inno.
- **`VOLT_BRIDGE_DLL` as a global user env var**, papering over `start_volt_codesys.py`'s stale install-dir fallback
  (`Programs\Volt\codesys-scriptcommands`, the flat-era path).
- **PATH is not broadcast** (no `ChangesEnvironment=yes`): the one thing Volt publishes for agents is invisible to
  Explorer-launched shells and editors until the next logon. Uninstall strips every PATH entry containing `\programs\volt`.
- **Size:** installer 208.4 MB (198.8 MiB), 650.9 MiB unpacked — Electron 369.3 MiB (48.3 MiB of locales, only en-US used), two self-contained
  .NET 10 runtimes (one of them, 199 files, dumped on PATH with `volt.exe`), WinForms satellite locales, PDBs.
- **An unverified silent update:** the updater downloads `Setup.exe` and runs it `/VERYSILENT` with no hash check.
- **The extension sideload** — superseded by `vscode-extension-marketplace`.

## What Changes

**A new installer, designed from the product as it is today; the old one is a requirements checklist, never a base.**
- **Flat layout** `%LOCALAPPDATA%\Programs\Volt\`: `bin\` (`volt.exe` single-file, `volt-lsp-iec.exe` — nothing else on
  PATH), `desktop\VoltDesktop.exe` (renamed; `productName` stays `Volt` so userData and the window title do not move),
  `connector\` (connector + TwinCAT worker on ONE runtime), `codesys\` (bridge DLL + scripts). No junction, no pruner.
- **Declarative Inno:** `[Files]`, `[Icons]` (Start Menu), `[Registry]` with `uninsdeletevalue` (Run key; PATH entry
  added and removed EXACTLY, `ChangesEnvironment=yes`), `[UninstallDelete]`. `[Code]` only: stop Volt's own processes by
  their own exe names; if a `volt.exe` (CLI) is running, WAIT for it (an interactive install says so; a silent update
  retries later) — never kill it; launch the connector at the end; mirror the setup log.
- **The connector writes nothing at install time** (no shortcut, no Run key, no env); `VoltConnector --uninstall` shrinks
  to removing the Documents\Volt script copy.
- **No `VOLT_BRIDGE_DLL` from the installer:** `start_volt_codesys.py` finds the DLL beside itself or at the fixed install
  path; the env var stays a dev-only override (`ide.ps1`).
- **Lean payload:** Electron `electronLanguages: [en-US]`, no Chromium license dump in the app dir beyond what the licence
  requires, single-file `volt.exe`, `SatelliteResourceLanguages=en`, no PDBs. Measured before/after.
- **A verified update:** `release.yml` publishes the installer's SHA-256 beside it; `Updater.cs` verifies the download
  against it before running it, and refuses by name on a mismatch.
- **One upgrade path from today's layout**, for one release: the new installer removes the `app-*` directories and the
  `current` junction, `VOLT_BRIDGE_DLL`, `OPENCODE_CONFIG_DIR`, the old Run value and the old shortcut — then this
  migration is deleted in the following release.
- **The extension leaves the installer** (as `vscode-extension-marketplace` decides); the uninstall keeps its
  `--uninstall-extension` lines for one release.
- **The gate (`test:install`):** keeps the binary-stamp oracle, rollback/log detection and leftover checks; asserts the
  shortcut, the Run key VALUE, the exact PATH entry, the Documents scripts and `desktop\VoltDesktop.exe` HARD; adds an
  upgrade-from-today's-layout run and a "`volt.exe` running during update is not killed" run; `promote.yml` gates a
  real upgrade with `--older <current stable>`.
- **Docs:** `installer/README.md` "every location" table rewritten from the new installer; CLAUDE.md and
  `scripts/README.md` current.

**Not in this change:** code signing (needs a certificate — the owner's); delta updates.

## Impact

`installer/`, `scripts/build-installer.ts`, `scripts/build-payload.ts`, `scripts/test-install.ts`, `scripts/version.ts`,
`.github/workflows/release.yml` + `promote.yml`, `packages/volt-cli/scripts/build-cli.ps1`,
`packages/volt-cli/scripts/start_volt_codesys.py`, `packages/volt-cli/src/Volt.Connector/` (Updater, VoltEnv, LoginItem,
Pruner, TrayContext), `packages/volt-desktop` (electron-builder config). Not released until the owner is back.
