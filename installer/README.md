# The Volt installer

One Inno Setup wizard (`Volt.iss` → `Volt-win-Setup.exe`) for every Volt app. Built by
`bun volt-scripts/build-installer.ts`; published to GitHub Releases by `release.yml`, which is also the update feed the
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

Two things that were **not** optimal, both fixed — worth knowing so they don't come back:

**`%APPDATA%\@volt\desktop\`** — Electron derives `userData` from `app.getName()`, which reads `productName`
before `name`. Without a `productName`, the name was `@volt/desktop` and Electron created a literal `@volt`
folder. `packages/volt-desktop/package.json` now sets `"productName": "Volt"`. That key is **load-bearing** — it
is not a duplicate of the `productName` in `electron-builder.yml` (which only brands the packaged `.exe`).
Upgrading users keep an orphaned `%APPDATA%\@volt` (~15 MB); it's inert and safe to delete by hand.

**`volt-config` shipped a `package.json`** — an untracked leftover from the retired `volt init` npm-install era.
It was gitignored, so CI never saw it and only *local* builds shipped it — and opencode **installs a config
dir's declared dependencies at runtime**, so it created `volt-config\node_modules` (27 packages) on first run and
needed a registry, on machines that specifically may not have one. Retired at three levels: the files are gone,
`build-payload.ts` refuses to copy them (`CFG_NEVER_SHIP`) so no dev box can leak them again, and `[InstallDelete]` wipes
`{app}\volt-config` on every install so **upgrading** users lose it too — `[Files]` alone would have left it
there forever.

## Upgrades delete nothing by default

Inno's `[Files]` only adds and overwrites. Anything an older version dropped survives every upgrade unless an
`[InstallDelete]` line names it. `{app}\volt-config` is wiped on each install for exactly this reason — it's
installer-owned, so "whatever shipped" is the only correct content.

Symmetrically, anything created *inside* `{app}` after install is untracked by Inno and would survive uninstall,
keeping `{app}` alive and making the uninstall dirty. `[UninstallDelete]` covers `{app}\volt-config` for that.
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

## Legacy directories (do NOT blind-delete)

Machines that ran pre-Inno builds may still carry these. The installer deliberately does **not** touch them —
an uninstaller that hunts for folders it didn't create is how you delete someone's data by accident.

| Location | Status | Safe to delete? |
|---|---|---|
| `%LOCALAPPDATA%\volt-updater\installer.exe` | Velopack-era update staging. **Zero references in the current source.** ~230 MB. | Yes — dead weight. |
| `%LOCALAPPDATA%\volt-bridge-new\` | old bridge worker pid/log dir. Zero references in the current source. | Yes. |
| `%APPDATA%\@volt\` | pre-0.2.0 Electron `userData`, orphaned by the `productName` fix. ~15 MB of caches. | Yes — inert. |
| `%LOCALAPPDATA%\volt-bridge\` | **still live** — `packages/volt-bridge/scripts/codesys-bridge.ps1` uses it as the headless dev-loop workdir. **Looks exactly like the dead ones.** | **No** — dev-only, but current. Users never create it. |
| `%LOCALAPPDATA%\Volt\` | current log store. | No. |
| `%APPDATA%\Volt\` | current Electron `userData`. | No. |

If a legacy sweep is ever added, it belongs behind an explicit user action ("clean up old Volt data") that names
what it will remove — never in the silent uninstall path.
