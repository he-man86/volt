# The Volt installer

One Inno Setup wizard (`Volt.iss` → `Volt-win-Setup.exe`) for every Volt app. Built by
`bun volt-scripts/build-installer.ts`; published to GitHub Releases by `release.yml`, which is also the update feed the
connector polls. **Per-user, no admin/UAC** — every location below is under the user's profile or HKCU.

## Every location Volt touches

Nothing is written outside this table. Keep it that way: a new location needs a line here and, if it outlives the
app, an `UninstallDelete` entry.

| Location | What | Written by | Removed on uninstall? |
|---|---|---|---|
| `%LOCALAPPDATA%\Programs\Volt\` | the whole install: connector at root, `bin\` (CLI+LSP), `opencode-config\`, `desktop\`, `docs\`, `volt-vscode.vsix`, `version.txt` | Inno (`DefaultDirName`) | **yes** — Inno owns it |
| `%LOCALAPPDATA%\Volt\logs\` | `connector-*.log`, `<vendor>-*.log`, `install-*.log` — the shared log store the tray's Log window reads | connector (`Log.cs`), bridges (Core's `VoltLog`), Setup (`DeinitializeSetup`) | **no** — deliberate, see below |
| `%APPDATA%\Microsoft\...\Start Menu\Programs\Volt.lnk` | Start Menu shortcut → the desktop GUI | connector (`VoltEnv.CreateGuiShortcut`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\Environment` → `OPENCODE_CONFIG_DIR`, `Path` | points opencode at `opencode-config\`; puts `bin\` on PATH | connector (`VoltEnv.Install`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\...\CurrentVersion\Run` → `VoltConnector` | login item so the tray survives reboot | connector (`LoginItem.cs`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\...\Uninstall\{AppId}_is1` | Add/Remove Programs entry | Inno | yes |
| `%APPDATA%\Volt\` | Electron `userData` (caches, blob storage) | Electron, from `productName` in `volt-desktop/package.json` | no |
| `%TEMP%\Volt-<version>-Setup.exe` | auto-update download | connector (`Updater.cs`) | no — `%TEMP%`, Windows reaps it |
| `%TEMP%\Setup Log*.txt` | Inno's own log | Setup (`SetupLogging=yes`) | no — `%TEMP%`, mirrored into the log store |

Not Volt's, but Volt-adjacent — **never** touched by the installer:

| Location | Why it's not ours |
|---|---|
| `%ProgramData%\CODESYS\Script Commands\` | CODESYS's own dir. The bridge DLL is *offered* there (`codesys-scriptcommands\` in the install dir); the user copies it. We don't write into a vendor's install. |
| opencode's data dir | opencode's auth/config. Volt is additive (one extra merged config dir) and never touches it — that's why uninstall reverts cleanly to vanilla opencode. |

`.volt/` (really `.git/volt`) is a per-project workspace binding inside the user's repo, not an install location.

## Is this optimal?

Yes, now. Four folders total: the install (`Programs\Volt`), the log store (`Volt\logs`), Electron's `userData`
(`%APPDATA%\Volt`), and `%TEMP%` scratch that Windows reaps. Plus three HKCU keys and one shortcut. That's the
floor for an app that must survive reboot and configure another tool.

Two invariants keep it that way — don't remove either without knowing what breaks:

**`"productName": "Volt"` in `packages/volt-desktop/package.json` is load-bearing.** Electron derives `userData`
from `app.getName()`, which reads `productName` before `name`; without it the name is `@volt/desktop` and Electron
writes to a literal `%APPDATA%\@volt` folder. It is **not** a duplicate of the `productName` in
`electron-builder.yml` (which only brands the packaged `.exe`).

**`opencode-config` must never ship a `package.json`.** opencode installs a config dir's declared dependencies at
runtime, so a stray `package.json` makes it create `opencode-config\node_modules` on first run and reach for a registry
— on machines that may not have one. `build-payload.ts` refuses to copy config `package.json`/`node_modules`
(`CFG_NEVER_SHIP`), and `[InstallDelete]` wipes `{app}\opencode-config` on every install so the dir is always exactly
what shipped.

## Upgrades delete nothing by default

Inno's `[Files]` only adds and overwrites. Anything an older version dropped survives every upgrade unless an
`[InstallDelete]` line names it. `{app}\opencode-config` is wiped on each install for exactly this reason — it's
installer-owned, so "whatever shipped" is the only correct content.

Symmetrically, anything created *inside* `{app}` after install is untracked by Inno and would survive uninstall,
keeping `{app}` alive and making the uninstall dirty. `[UninstallDelete]` covers `{app}\opencode-config` for that.
`test:install` cannot catch this class: it never runs opencode, so nothing is ever created post-install.

## Install diagnostics

`SetupLogging=yes` + `DeinitializeSetup` mirror Setup's log to `%LOCALAPPDATA%\Volt\logs\install-<date>.log` —
the same store the connector and bridges write, so the tray's Log window shows install history beside runtime
history. `DeinitializeSetup` runs even on an **aborted** install, which is the case actually worth having.

Exit codes worth knowing (Inno's, unchanged by us):

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | user cancelled before install started |
| 5 | **aborted during install** — in practice: Setup couldn't close a running Volt process. Under `/VERYSILENT` there's no prompt, so it just dies. Close Volt and retry. |

`bun run test:install` stops the connector + bridge workers before installing for exactly this reason.

## Known gaps

**A failed auto-update leaves the tray dead until next login.** `Updater.cs` launches Setup and immediately
`Environment.Exit(0)`s — it *must*, to release its own file locks — so it cannot observe the exit code. On
success Inno's `[Run]` relaunches the connector; on failure nothing does, and the login item only recovers at the
next sign-in. The new install log is now the only trace. Fixing this properly needs a relaunch watchdog that
outlives both processes; not worth it until it actually bites.

**The extension tasks are never smoke-tested.** They're `Check: NotSilent`, and `test:install` runs
`/VERYSILENT` — so CI proves the `.vsix` ships, never that it installs. Only a human clicking the wizard covers
that.
