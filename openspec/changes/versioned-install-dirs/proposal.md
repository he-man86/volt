## Why

Volt's installer overwrites files in a directory that is in use, so every update fights file locks — and loses in a way that is silent and total. A file held open (`bin/volt-lsp-iec.exe`, spawned by opencode and alive for the whole session) makes Inno retry, then default the suppressed Abort/Retry/Ignore box to **Abort**, and **roll back the entire install** with no visible error. Observed in the wild: the connector updated while `bin/volt.exe` — which sorts after the locked file, so the run never reached it — stayed several releases behind, the `[Run]` step never fired so the tray never restarted, and a shipped CLI feature (`volt pull --force`) looked broken for days.

The current mitigation stops Volt's own processes in `PrepareToInstall`/`CurUninstallStepChanged`. It passes the full lifecycle gate, but it is a stopgap: it bets on the OS releasing handles inside a fixed sleep, and it depends on a **hardcoded image list** that someone must remember to extend. That list is exactly what failed — `volt-lsp-iec.exe` was missing from it. The next binary added under `{app}` breaks updates again, the same silent way.

## What Changes

- Install the payload into a **versioned directory** (`{app}\app-<version>\`) instead of directly into `{app}`, and point a stable `{app}\current` **junction** at it. An update writes a new directory and repoints the junction — it never writes to a file anyone has open, so the lock/rollback class disappears rather than being mitigated.
- **The Inno wizard is kept.** Versioned directories are a layout choice, not a framework feature; this is explicitly not a migration to Velopack, whose Windows `Setup.exe` is one-click by design and cannot host Volt's component checkboxes.
- Every externally-referenced path becomes **version-stable**: `PATH` and `OPENCODE_CONFIG_DIR` point through `{app}\current\...`, the Start Menu shortcut and login item target a stable path, so no update rewrites environment or shortcuts.
- Old versions are **pruned by the connector at startup**, when nothing holds them — not at install time, and not at reboot.
- A failed update leaves the previous version **intact and runnable**, which the current design cannot do (today a failed update leaves a half-applied install).
- Retire the process-killing stopgap once the new layout proves out, so updates no longer terminate the user's running desktop app.
- **BREAKING** (internal): the on-disk layout under `{app}` changes, so the first install after this must migrate an existing flat install.

## Capabilities

### New Capabilities
- `versioned-install-layout`: how a Volt install is laid out on disk, how an update lands atomically, which paths are guaranteed stable across versions, and how superseded versions are pruned.

### Modified Capabilities
<!-- None: openspec/specs/ holds no installer capability today (the archived spec tree was removed; installer
     invariants live in installer/README.md + Volt.iss comments). This change introduces the first one. -->

## Impact

- `installer/Volt.iss` — `[Files]` DestDir, `[Icons]`, `[Run]`, `[UninstallDelete]`, the `[Code]` junction management, and the migration of an existing flat install. The `PrepareToInstall` / `CurUninstallStepChanged` process-kill stays until the new layout is proven, then is removed.
- `volt-scripts/build-installer.ts` / `build-payload.ts` — the stage layout gains the version-directory shape.
- `packages/volt-cli/src/Volt.Cli.Connector` — `VoltEnv` (PATH + `OPENCODE_CONFIG_DIR` must target `current`), `LoginItem`, `Updater` (prune superseded `app-*` directories at startup; it already knows how to re-run Setup).
- `volt-scripts/test-install-lifecycle.ts` — the gate that must prove the migration: it already asserts per-binary versions, rollback detection, extension registration and zero leftovers across install → uninstall → install → update → update → uninstall → install → uninstall.
- No change to the `volt` CLI, the bridges, or either frontend: they resolve `volt` from `PATH`, which stays stable by design.
