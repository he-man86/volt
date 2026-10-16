# The Volt installer

One Inno Setup wizard (`Volt.iss` → `Volt-win-Setup.exe`) for every Volt app: the desktop app, the `volt` CLI + the
LSP on PATH, the tray connector (+ the TwinCAT worker) and the CODESYS bridge. Built by
`bun scripts/build-installer.ts`; published to GitHub Releases by `release.yml`, which is also the update feed the
connector polls. **Per-user, no admin/UAC** — every location below is under the user's profile or HKCU. Designed in
openspec `installer-rebuild` (2026-10-12); the installer before it (an `app-<version>` + `current` junction layout,
a connector that wrote the shortcut / Run key / env at runtime) is gone, with no upgrade path from it.

## Every location Volt touches

Nothing is written outside this table. Keep it that way: a new location needs a line here and, if it outlives the
app, a declared section (`[Files]`, `[Icons]`, `[Registry]` `uninsdeletevalue`) or an `[UninstallDelete]` entry.

**`dist/stage` IS `{app}`**: the four folders below are copied 1:1, so the build, the gate (`test-install.ts`) and
this table name the same paths.

| Location | What | Written by | Removed on uninstall? |
|---|---|---|---|
| `%LOCALAPPDATA%\Programs\Volt\bin\` | `volt.exe` (single-file, self-contained) + `volt-lsp-iec.exe` — exactly these two files; the only folder on PATH | Inno `[Files]` | **yes** — `[UninstallDelete]` (the folder whole) |
| `%LOCALAPPDATA%\Programs\Volt\bin\git\` | the CLI's own git: MinGit (Git for Windows' redistributable, unmodified; pin + SHA-256 in `packages/volt-cli/src/Volt.Cli/MinGit.targets`), with its `LICENSE.txt` (GPLv2) and `VOLT-SOURCE.txt` (where the binary and its source are). `volt.exe` runs `git\cmd\git.exe` by path — a subfolder, so NOT on PATH, and no other program sees it. The full CLI install only: the bridge bundles (`connector\`, `codesys\` — also what PLCAssist distributes) carry no git (openspec environment-dependency-audit 2.1) | Inno `[Files]` (inside `bin\`); an update first clears it whole (`[InstallDelete]`), so two MinGit versions never mix | **yes** — with `bin\` |
| `%LOCALAPPDATA%\Programs\Volt\desktop\` | the Electron app, `VoltDesktop.exe` (`en-US` locale only) | Inno `[Files]` | yes — `[UninstallDelete]` |
| `%LOCALAPPDATA%\Programs\Volt\connector\` | `VoltConnector.exe` (tray) + `VoltBridgeTwincat.exe` (TwinCAT worker), ONE .NET runtime; `VoltTwincatExplorer.exe` (the worker's x86 net48 reader of a 32-bit XAE's Solution Explorer) | Inno `[Files]` | yes — `[UninstallDelete]` |
| `%LOCALAPPDATA%\Programs\Volt\codesys\` | `Volt.Ide.Codesys.dll` + `start_volt_codesys.py` / `stop_volt_codesys.py` | Inno `[Files]` | yes — `[UninstallDelete]` |
| `%LOCALAPPDATA%\Programs\Volt\unins000.*` | Inno's uninstaller + its log (`UninstallLogMode=overwrite`). ONE uninstaller, the one Add/Remove runs — test:install asserts it | Inno | yes |
| `Documents\Volt\start_volt_codesys.py`, `stop_volt_codesys.py` | the VISIBLE copy of the CODESYS scripts (users run them from CODESYS' Scripting menu); the copy finds the DLL at the fixed `Programs\Volt\codesys` (`_INSTALL_SUBDIR`) | connector at startup (`VoltEnv.PublishCodesysScripts`, from `..\codesys`) | yes — `[UninstallDelete]` (the two files, then the folder if empty) |
| `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Volt.lnk` | Start Menu shortcut → `{app}\desktop\VoltDesktop.exe` | Inno `[Icons]` | yes |
| `HKCU\...\CurrentVersion\Run` → `VoltConnector` | `"{app}\connector\VoltConnector.exe" --silent` — the tray survives a reboot | Inno `[Registry]` | yes — `uninsdeletevalue` |
| `HKCU\Environment` → `Path` | the ONE entry `{app}\bin`, appended; nothing else in PATH is touched (the value's type and trailing `;` kept) | `[Code]` `AddPathEntry` (`ChangesEnvironment=yes` broadcasts it) | yes — `[Code]` `RemovePathEntry` drops every `{app}\bin` entry and rejoins the rest unchanged (type, empty parts, trailing `;`); a value left with no entry is deleted. It cannot tell an entry Volt added from one that was there before (`AddPathEntry` leaves a PATH that already names `{app}\bin` alone), so a pre-existing `{app}\bin` goes too, and a PATH that held exactly that one entry is deleted — the gate refuses such a machine, so that case is not run |
| `HKCU\...\Uninstall\{AppId}_is1` | Add/Remove Programs entry; its `DisplayVersion` is what the gate calls "the installed version" | Inno | yes |
| `%LOCALAPPDATA%\Volt\logs\` | `connector-*.log`, `<vendor>-*.log`, `install-<date>_<time>.log`, `uninstall-<date>.log` — the shared log store the tray's Log window reads | connector, bridges (`VoltLog`), setup (`DeinitializeSetup`), uninstaller (`VLog`) | **no** — deliberate: an uninstall's own trace outlives it |
| `%APPDATA%\Volt\` | Electron `userData` | Electron, from `productName` `Volt` | no |
| `%LOCALAPPDATA%\Volt\update-channel.txt` | the update channel (`stable` / `dev`), written when it is switched in the tray's Status window | connector (`Updater.SetChannel`) | **no** |
| `%LOCALAPPDATA%\Volt\wanted.json` | the connector's desired bridge set, kept across restarts | connector (`ConnectionManager`) | **no** |
| `%TEMP%\Volt\codesys-bridge\<CODESYS pid>\` | a per-IDE-session copy of `Volt.Ide.Codesys.dll` (+ its `.json` relay sidecars), loaded instead of the installed one so CODESYS never locks a file under `{app}` (why the installer need not stop CODESYS) | `start_volt_codesys.py` (`_stage`) | **no** — `%TEMP%`; the next start prunes the copies of closed sessions |
| `%TEMP%\volt_move_*.zip`, `%TEMP%\VoltScratch_*.xml` | TwinCAT bridge scratch files (a move, a graphical body) | TwinCAT worker | deleted after use — except a move whose undo failed: its zip is then the only copy of the item |
| `%TEMP%\Volt-<version>-Setup.exe` | auto-update download — written only AFTER its SHA-256 matched the release asset's `digest` | connector (`Updater.cs`) | no — `%TEMP%`; the connector deletes old ones |
| `%TEMP%\Setup Log*.txt` | Inno's own log | setup (`SetupLogging=yes`) | no — `%TEMP%`, mirrored into the log store |

**No environment variable but PATH.** `VOLT_BRIDGE_DLL` is a dev-only override (`ide.ps1`); no installer writes it:
`start_volt_codesys.py` finds the DLL beside itself or at the fixed install path. The connector writes nothing at
install time — no shortcut, no Run key, no env (it once did all three, which let a dev build repoint the Start Menu).

Not Volt's, but Volt-adjacent — **never** touched by the installer:

| Location | Why it's not ours |
|---|---|
| `%ProgramData%\CODESYS\Script Commands\` | CODESYS's own dir. The bridge is offered in `{app}\codesys\` and through the Documents copy of the start script; we don't write into a vendor's install. |
| Any AI agent's config (`~/.claude/`, `~/.cursor/`, `%APPDATA%\Claude\`) | Theirs. Volt installs into no agent and edits no agent's configuration — the installer publishes `PATH`. |

`.volt/` (really `.git/volt`) is a per-project workspace binding inside the user's repo, not an install location.

## Processes: stopped by path, the CLI waited on

`CloseApplications=no` (the Restart Manager closes whatever holds a file — a running `volt.exe` among them). `[Code]`
finds processes through ONE mechanism, Windows' own process snapshot (`Processes.iss`: kernel32's
`CreateToolhelp32Snapshot` for every image name, `QueryFullProcessImageNameW` for its path — never WMI, which a machine
may have disabled; environment-dependency-audit 2.7), path-scoped to folders under `{app}` — a dev tray or a
`volt.exe` from a checkout is never touched:

1. **Wait for the CLI first.** A `volt.exe` in a `bin\` folder under `{app}` (or one named `volt.exe` whose path cannot be read at
   all; fail closed) may be mid-`volt push` to a live PLC: it is **never killed**. Interactive:
   a Retry/Cancel box naming it. Silent: poll up to `/VOLTWAIT=<s>` (default 3600), then give up — setup exits
   non-zero with nothing stopped, the uninstaller aborts with nothing removed.
2. **Then stop Volt's own processes** (tray, TwinCAT worker, desktop, LSP) by path, in rounds of at most 30 s wall
   clock; a CLI that starts during the stop sends it back to step 1. The wait comes first because the TwinCAT worker
   is the far end of the CLI's pipe. **An elevated Volt process** (a tray or worker started "as administrator") is
   seen — the snapshot reads its path, where WMI read none and the old stop walked past it into a locked file — but
   this per-user setup may not stop it (`ERROR_ACCESS_DENIED`): the stop gives up at once and the setup (or the
   uninstaller) says so by name, "… runs elevated … close it, or run the setup as administrator", with nothing
   changed. `ConnectorRunning` counts an elevated tray as running too (it is). VM checklist row 7.
3. **Relaunch the tray** at the end of every setup that reached `PrepareToInstall` (`DeinitializeSetup`), so a
   give-up, an abort or a rollback never leaves the machine without a tray and its TwinCAT worker. After a completed
   install `[Run]` already started it.

The auto-update's tray (`TrayContext.ApplyUpdate`) also waits for a running `{app}\bin\volt.exe` before it disposes
its worker fleet and launches the verified setup `/VERYSILENT`.

## Install diagnostics

`SetupLogging=yes` + `DeinitializeSetup` mirror setup's log to `%LOCALAPPDATA%\Volt\logs\install-<date>_<time>.log`
(per run, so a retry never overwrites a failure). The uninstaller appends its own lines to
`uninstall-<date>.log` (one file per day). `DeinitializeSetup` runs on an **aborted** install too — the case worth
having.

### The log markers — the support contract

Every installer action logs a line prefixed `volt:`; every line of the uninstall log carries it. Enforced twice:
`build-installer.ts` refuses a `Volt.iss` missing any marker, and `test-install.ts` (`installMarkers` /
`uninstallMarkers`) asserts them, in order, in what each step appended to the log. A `FAILED` line names the broken
step.

An install, in order:

```
volt: install <version> -> <dir>, mode=silent|interactive, existing=0|1
volt: stopped <n> Volt process(es) under <dir>: <exe (pid)>,…
volt: PATH carries <dir>\bin                     ← read back, not assumed
volt: the connector is running - nothing to relaunch   (or `relaunched the connector: …`)
```

An uninstall:

```
volt: uninstall <version> from <dir>, mode=silent|interactive
volt: stopped <n> Volt process(es) under <dir>: …
volt: PATH no longer carries <dir>\bin
```

The CLI wait, either direction:

```
volt: waiting for volt.exe (pid <n>, <path>) before the update|uninstall - it is never stopped
volt: volt.exe exited - the update|uninstall continues
volt: gave up waiting for volt.exe (pid <n>) after <s> s - no update|uninstall was done
volt: volt.exe started (pid <n>, …) while Volt's processes were being stopped - back to waiting for it
```

**Rule that keeps this from rotting: an installer action without a log line is not finished.**

Exit codes worth knowing:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | uninstaller: aborted (a CLI it gave up waiting for, or a stop that failed) — nothing removed |
| 2 | user cancelled before install started |
| 7 | setup: `PrepareToInstall` refused — a CLI it gave up waiting for, or a stop that failed. Nothing changed; the tray is relaunched. The auto-update offers it again later. |

## The gate

`bun run test:install --older <setup.exe|previous>` (Windows; really installs): install the older build → update to
the new one → update again → update with a live `volt.exe` (`/VOLTWAIT=15`: exit non-zero, CLI and
tray untouched, no binary replaced) → the same with the CLI ending mid-wait → uninstall with a live CLI (aborted) →
uninstall (clean; the PATH value byte-identical to the run's start — existence, registry type, exact string) → fresh install → uninstall → the updater's digest tests. It refuses to start
on a machine that is not clean (Volt installed, a Volt process or any `volt.exe` running, a leftover shortcut, Run
value or Documents script). `promote.yml` runs it with `--older previous`.

## Invariants

**`"productName": "Volt"` in `packages/volt-desktop/package.json` is load-bearing.** Electron derives `userData`
from it; the exe is `VoltDesktop.exe` (`executableName`), so it never shares an image name with the CLI's `volt.exe`
— that collision once let an update `taskkill` a running `volt push`.

**`DisableDirPage=yes`.** The Documents copy of the start script finds the bridge at the FIXED
`Programs\Volt\codesys`; a user-chosen dir would break it.

**PATH never goes through `[Registry]`.** `uninsdeletevalue` on `HKCU\Environment\Path` deletes the user's whole
PATH.

## Known gaps

**Unsigned.** Code signing needs a certificate (the owner's); SmartScreen warns on first run. Delta updates: not
done — every update downloads the whole installer.
