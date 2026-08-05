# The Volt installer

One Inno Setup wizard (`Volt.iss` → `Volt-win-Setup.exe`) for every Volt app. Built by
`bun scripts/build-installer.ts`; published to GitHub Releases by `release.yml`, which is also the update feed the
connector polls. **Per-user, no admin/UAC** — every location below is under the user's profile or HKCU.

## Every location Volt touches

Nothing is written outside this table. Keep it that way: a new location needs a line here and, if it outlives the
app, an `UninstallDelete` entry.

The install is laid out in **version directories behind a `current` junction** — see "Versioned layout" below.
Everything recorded OUTSIDE `{app}` resolves through `{app}\current`, never through a version directory; that is
the one invariant the whole layout rests on.

| Location | What | Written by | Removed on uninstall? |
|---|---|---|---|
| `%LOCALAPPDATA%\Programs\Volt\app-<version>\` | one whole payload per version: connector at root, `bin\` (CLI+LSP), `desktop\`, `docs\`, `codesys-scriptcommands\`, `volt-vscode.vsix` (no version.txt — every binary carries its version stamped in) | Inno (`[Files]` → `app-{#AppVersion}`) | **yes** — Inno owns it; uninstall removes every `app-*` |
| `%LOCALAPPDATA%\Programs\Volt\current` | junction → the active version directory; the only path anything outside `{app}` references | `[Code]` `SetCurrentJunction` (`rmdir`+`mklink /J`) | yes — `rmdir` unlinks it, then version dirs go |
| `%LOCALAPPDATA%\Volt\logs\` | `connector-*.log`, `<vendor>-*.log`, `install-*.log`, `uninstall-*.log` — the shared log store the tray's Log window reads | connector (`Log.cs`), bridges (Core's `VoltLog`), Setup (`DeinitializeSetup` + `ULog`) | **no** — deliberate, see below |
| `%APPDATA%\Microsoft\...\Start Menu\Programs\Volt.lnk` | Start Menu shortcut → the desktop GUI | connector (`VoltEnv.CreateGuiShortcut`) | yes (`VoltEnv.Uninstall`) |
| `HKCU\Environment` → `Path`, `VOLT_BRIDGE_DLL` | puts `current\bin` on PATH (the ONLY thing Volt publishes for agents); names the CODESYS bridge DLL. `PublishEnv` also deletes a stale `OPENCODE_CONFIG_DIR` left by an install predating the opencode removal | **the installer** (`[Code]` `PublishEnv`) | yes (`[Code]` `CurUninstallStepChanged`) |
| `HKCU\...\CurrentVersion\Run` → `VoltConnector` | login item so the tray survives reboot | connector (`LoginItem.cs`) | yes (`CurUninstallStepChanged`) |
| `HKCU\...\Uninstall\{AppId}_is1` | Add/Remove Programs entry | Inno | yes |
| `%APPDATA%\Volt\` | Electron `userData` (caches, blob storage) | Electron, from `productName` in `volt-desktop/package.json` | no |
| `%TEMP%\Volt-<version>-Setup.exe` | auto-update download | connector (`Updater.cs`) | no — `%TEMP%`, Windows reaps it |
| `%TEMP%\Setup Log*.txt` | Inno's own log | Setup (`SetupLogging=yes`) | no — `%TEMP%`, mirrored into the log store |

**Env vars have ONE owner: the installer.** They used to be written by `VoltConnector` on startup *and* implied by
the layout, and that dual ownership caused four ordering bugs in a row (the connector computes its paths from where
its own exe sits, so when it started before `{app}\current` existed it published version-scoped values). `PublishEnv`
in `Volt.iss` is now the sole writer; `VoltEnv.cs` keeps only the login item, the shortcut, and the visible copy of
the CODESYS scripts.

Not Volt's, but Volt-adjacent — **never** touched by the installer:

| Location | Why it's not ours |
|---|---|
| `%ProgramData%\CODESYS\Script Commands\` | CODESYS's own dir. The bridge DLL is *offered* there (`codesys-scriptcommands\` in the install dir); the user copies it. We don't write into a vendor's install. |
| Any AI agent's config (`~/.claude/`, `~/.cursor/`, `%APPDATA%\Claude\`) | Theirs. Volt installs into no agent and edits no agent's configuration — the installer publishes `PATH`, and every host integration is either a registry-published artifact or a snippet the user pastes. Volt once shipped an `opencode-config\` directory here via `OPENCODE_CONFIG_DIR`; it is gone. |

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

**No agent-config payload ships.** An `opencode-config\` directory used to, and its handling is the cautionary
tale: it could not contain a `package.json`, because opencode installs a config dir's declared dependencies at
*runtime* — on PLC machines that may have no registry — so `build-payload.ts` carried a `CFG_NEVER_SHIP` filter
to guarantee the payload could never include one. That is the shape of maintaining a foothold inside someone
else's product. The directory, the filter and the `[InstallDelete]`/`[UninstallDelete]` entries that chased it
are all deleted.

## Versioned layout

Each install writes a full payload into `{app}\app-<version>\` and repoints the `{app}\current` junction at it —
the last thing setup does before `[Run]`. An update writes a *new* directory and repoints; it never overwrites a
file a running process holds open, so the file-lock/rollback failure class is gone rather than mitigated. A failed
update leaves the previous version intact and `current` still pointing at it. Superseded version directories are
pruned by the connector at its next start (nothing holds them then), retaining at most two.

One non-obvious hazard, found the hard way and now guarded: **a reparse point is not reliably resolvable by the
process that just created it.** `DirExists({app}\current\bin)` returned FALSE one millisecond after `mklink`
returned, while the same directory probed directly was TRUE and the junction was provably correct seconds later. So
inside setup, `PublishEnv` and the connector launch VERIFY against the real `app-<version>` directory; only the
values they RECORD use the stable `current` form. The two `probe direct` / `probe junction` log lines exist to keep
that attributable.

## Upgrades and uninstall are clean by construction

`[Files]` only adds, but because every install lands in its own `app-<version>`, "stale files from an older
version" cannot shadow a new one — the junction points at exactly one version and PATH resolves through it.
Uninstall removes the junction with `rmdir` (never a recursive delete, which would delete *through* it), then every
`app-*` directory, so `{app}` ends up gone. Anything created inside a version dir post-install goes with it.

## Install diagnostics

`SetupLogging=yes` + `DeinitializeSetup` mirror Setup's log to `%LOCALAPPDATA%\Volt\logs\install-<date>.log` —
the same store the connector and bridges write, so the tray's Log window shows install history beside runtime
history. `DeinitializeSetup` runs even on an **aborted** install, which is the case actually worth having.

### The log markers — the support contract

Every meaningful installer action logs a line prefixed `volt:`. When a customer sends a log, these are what to
grep for. Their absence or an out-of-order sequence is a bug; a `WARNING`/`FAILED`/`MISSING` line names it. The
list is enforced in two places — `test-install.ts` (`assertLog`) asserts the sequence on every run, and
`build-installer.ts` refuses to build a `Volt.iss` missing any of them — so it cannot silently rot.

An install, in order:

```
volt: install <version> -> <dir>, mode=silent|interactive, existing=0|1   ← what this run is
volt: junction active -> <dir>\app-<version>                              ← current repointed
volt: probe direct  \bin exists=1   /  probe junction \bin exists=0|1     ← the reparse-visibility race, logged
volt: VOLT_BRIDGE_DLL=…            (or "not present" on a build without it)
volt: appended to user PATH: …\current\bin   (or "already contains … - left unchanged")
volt: env published -> …\current\bin                                      ← UNCONDITIONAL; the marker the gates assert
volt: started the connector: …\app-<version>\VoltConnector.exe           ← the tray is up
```

An uninstall:

```
volt: stopped running Volt processes, taskkill exit=…
volt: reverting environment
volt: PATH rewritten without Volt entries
volt: removed the junction and every version directory                   ← {app} is now empty
```

A `WARNING … does not exist on disk` after a path was recorded, `FAILED to …`, or `connector MISSING` each point
at a specific broken step — that is the whole reason they are worded to be greppable. **Rule that keeps this from
rotting: an installer action without a log line is not finished.**

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
success `ssPostInstall` relaunches the connector (logged as `started the connector`); on failure nothing does, and
the login item only recovers at the next sign-in. The install log is the trace: its last `volt:` line tells you
how far setup got. Fixing this properly needs a relaunch watchdog that outlives both processes; not worth it until
it actually bites.

**The extension tasks are never smoke-tested.** They're `Check: NotSilent`, and `test:install` runs
`/VERYSILENT` — so CI proves the `.vsix` ships, never that it installs. Only a human clicking the wizard covers
that.
