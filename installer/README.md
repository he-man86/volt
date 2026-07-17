# The Volt installer

One Inno Setup wizard (`Volt.iss` → `Volt-win-Setup.exe`) for every Volt app. Built by
`bun volt-scripts/build-app.ts`; published to GitHub Releases by `release.yml`, which is also the update feed the
connector polls. **Per-user, no admin/UAC** — every location below is under the user's profile or HKCU.

## Every location Volt touches

Nothing is written outside this table. Keep it that way: a new location needs a line here and, if it outlives the
app, an `UninstallDelete` entry.

| Location | What | Written by | Removed on uninstall? |
|---|---|---|---|
| `%LOCALAPPDATA%\Programs\Volt\` | the whole install: connector at root, `bin\` (CLI+LSP), `volt-config\`, `desktop\`, `docs\`, `volt-vscode.vsix`, `version.txt` | Inno (`DefaultDirName`) | **yes** — Inno owns it |
| `%LOCALAPPDATA%\Volt\logs\` | `connector-*.log`, `<vendor>-*.log`, `install-*.log` — the shared log store the tray's Log window reads | connector (`Log.cs`), bridges (Core's `VoltLog`), Setup (`DeinitializeSetup`) | **no** — deliberate, see below |
| `%APPDATA%\Microsoft\...\Start Menu\Programs\Volt.lnk` | Start Menu shortcut → the desktop GUI | connector (`VoltEnv.CreateGuiShortcut`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\Environment` → `OPENCODE_CONFIG_DIR`, `Path` | points opencode at `volt-config\`; puts `bin\` on PATH | connector (`VoltEnv.Install`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\...\CurrentVersion\Run` → `VoltConnector` | login item so the tray survives reboot | connector (`LoginItem.cs`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\...\Uninstall\{AppId}_is1` | Add/Remove Programs entry | Inno | yes |
| `%APPDATA%\@volt\desktop\` | Electron `userData` (caches, blob storage) | Electron, implicitly | **no** — and the name is wrong, see below |
| `%TEMP%\Volt-<version>-Setup.exe` | auto-update download | connector (`Updater.cs`) | no — `%TEMP%`, Windows reaps it |
| `%TEMP%\Setup Log*.txt` | Inno's own log | Setup (`SetupLogging=yes`) | no — `%TEMP%`, mirrored into the log store |

Not Volt's, but Volt-adjacent — **never** touched by the installer:

| Location | Why it's not ours |
|---|---|
| `%ProgramData%\CODESYS\Script Commands\` | CODESYS's own dir. The bridge DLL is *offered* there (`codesys-scriptcommands\` in the install dir); the user copies it. We don't write into a vendor's install. |
| opencode's data dir | opencode's auth/config. Volt is additive (one extra merged config dir) and never touches it — that's why uninstall reverts cleanly to vanilla opencode. |

`.volt/` (really `.git/volt`) is a per-project workspace binding inside the user's repo, not an install location.

## Is this optimal?

Mostly yes. Two exceptions, both real:

**`%APPDATA%\@volt\desktop\` is sprawl with an ugly name.** Electron derives `userData` from `app.getName()`,
which reads `packages/volt-desktop/package.json` → `"name": "@volt/desktop"` → a literal `@volt` folder with a
`desktop` subfolder. It should be `%APPDATA%\Volt`. Fixing it means adding `"productName": "Volt"` to that
package.json — one line — but it **orphans** the existing `%APPDATA%\@volt` (~15 MB of Electron caches) on every
current install, and silently drops any GUI state living there. Cheap to fix, not free to ship. Not done yet.

**Uninstall leaves the log store and `userData` behind.** Deliberate for logs — you usually want them *after*
uninstalling something that misbehaved, and it's 5 KB. `%APPDATA%\@volt` at ~15 MB is harder to defend. If either
should go, they're `[UninstallDelete]` one-liners; `test-install.ts` would need matching cleanup assertions,
since "cleanliness is the guarantee" there.

Everything else is one folder (`Programs\Volt`) plus one data folder (`Volt\logs`) plus three HKCU keys. That's
the floor for an app that must survive reboot and configure another tool.

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

## Legacy directories (do NOT blind-delete)

Machines that ran pre-Inno builds may still carry these. The installer deliberately does **not** touch them —
an uninstaller that hunts for folders it didn't create is how you delete someone's data by accident.

| Location | Status | Safe to delete? |
|---|---|---|
| `%LOCALAPPDATA%\volt-updater\installer.exe` | Velopack-era update staging. **Zero references in the current source.** ~230 MB. | Yes — dead weight. |
| `%LOCALAPPDATA%\volt-bridge-new\` | old bridge worker pid/log dir. Zero references in the current source. | Yes. |
| `%LOCALAPPDATA%\volt-bridge\` | **still live** — `packages/volt-bridge/scripts/codesys-bridge.ps1` uses it as the headless dev-loop workdir. | **No** — dev-only, but current. Users never create it. |
| `%LOCALAPPDATA%\Volt\` | current log store. | No. |
| `%APPDATA%\@volt\` | current Electron `userData` (see above). | No, while the name stands. |

If a legacy sweep is ever added, it belongs behind an explicit user action ("clean up old Volt data") that names
what it will remove — never in the silent uninstall path.
