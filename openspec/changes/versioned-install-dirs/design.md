## Context

Volt installs per-user (`PrivilegesRequired=lowest`) into `{localappdata}\Programs\Volt` via an Inno wizard, and the always-on connector drives auto-update by downloading a newer `Setup.exe` and re-running it `/VERYSILENT`. Four long-lived processes live under that directory — `VoltConnector.exe`, `VoltBridgeTwincat.exe`, the Electron `Volt.exe`, and `volt-lsp-iec.exe` (spawned by opencode, alive for the whole session) — and each self-contained .NET binary keeps its own runtime (`clrjit.dll`, `coreclr.dll`, `hostfxr.dll`) loaded while it runs.

Overwriting that directory in place is therefore a fight with file locks, and Inno loses badly: a locked file produces a retry loop, then an Abort/Retry/Ignore box that `/SUPPRESSMSGBOXES` **defaults to Abort**, and the whole install **rolls back** — silently, exit 5. This shipped. `bin/volt.exe` sorts after `bin/volt-lsp-iec.exe`, so the run never reached it and the CLI sat several releases behind the connector while `volt pull --force` appeared broken.

Two mitigations were tried and are now understood:
- `restartreplace` — needs administrative rights to schedule a reboot-time replace. Volt is per-user. It was applied, and the lifecycle gate showed setup still rolling back.
- Restart Manager (`CloseApplications=yes`) — cannot gracefully close a self-contained .NET app, and its async force-close races the file copy. Already rejected in `Volt.iss` with those reasons.

What is in place today is `PrepareToInstall` + `CurUninstallStepChanged` terminating Volt's own processes. It passes the full lifecycle gate, but it is a stopgap on two counts: it bets on the OS releasing handles inside a fixed sleep, and it drives off a **hardcoded image list** — the list that already failed once by omitting `volt-lsp-iec.exe`.

## Goals / Non-Goals

**Goals:**
- Remove the file-lock/rollback failure *class*, rather than mitigating it: an update must never write to a file any process holds open.
- A failed update leaves the previous version intact and runnable.
- Keep the Inno wizard and its component checkboxes (opencode via winget, per-editor extension).
- Keep every externally-recorded path stable, so an update never rewrites `PATH`, `OPENCODE_CONFIG_DIR`, the shortcut or the login item.
- Stop terminating the user's running desktop app to install an update.
- Prove the migration with the existing lifecycle gate, run with editors open.

**Non-Goals:**
- Migrating to Velopack. Its Windows `Setup.exe` is one-click **by design** (docs: "will not show any questions / wizards"; wizard support is an open request, velopack#30), so it cannot host Volt's component checkboxes. Versioned directories are a layout choice, not a Velopack feature — Inno can do this.
- MSIX. Atomic and OS-managed, but wants packaging + signing and imposes constraints out of proportion to the problem.
- Delta/patch updates. Full payload per version stays; disk is the accepted cost.
- Changing how the connector *decides* to update (channel, polling, the "Restart to update" prompt). Only how files land changes.

## Decisions

**Layout: version directories behind a `current` junction.**
```
{app}\
  current\              → junction to app-<version>
  app-0.0.1.15810\      bin\ connector files, desktop\, opencode-config\, docs\, version.txt
  app-0.0.1.15807\      previous — pruned by the connector at next start
  unins000.exe
```
`[Files] DestDir: "{app}\app-{#AppVersion}"`. Activation is repointing the junction, which is the last thing setup does before `[Run]`.

*Why a junction over a launcher shim:* a shim means writing and maintaining a process that re-executes the real binary, and it distorts process identity — `taskkill`, the tray, and `Environment.ProcessPath` would all see the shim. A junction is a filesystem-level indirection with no runtime cost and no new binary. *Why not a symlink:* directory symlinks need Developer Mode or admin on Windows; junctions do not, which matters for a per-user install.

*Why repointing is safe while files are open:* a process holding a handle under the old target keeps that handle — Windows resolves the reparse point at open time, not per I/O. Nothing breaks mid-session; the new version is picked up when the process next starts.

**Everything external points at `current`, nothing at a version.** `PATH` gets `{app}\current\bin`, `OPENCODE_CONFIG_DIR` gets `{app}\current\opencode-config`, the shortcut and login item target `{app}\current\...`. This is what makes an update a no-op for the environment — and it is load-bearing: if any recorded path carried a version, every update would have to rewrite `HKCU` and we would have traded a file-lock race for a registry one.

**Pruning belongs to the connector, not the installer.** At install time the old version is by definition still in use (its processes are running, and the connector may itself be the process that launched setup). At connector startup nothing holds the superseded directory. Best-effort with a log line; never fatal. Retain 2.

**The process-kill stopgap stays until the gate passes, then goes.** Removing it in the same step would conflate "the new layout works" with "the old mitigation was unnecessary". Keep it, prove the layout, then delete it and re-run the gate to show it is genuinely unneeded.

**Migration of an existing flat install is explicit.** The first upgrade must delete the flat payload — otherwise `{app}\bin` (flat) and `{app}\current\bin` both exist, and whichever `PATH` lists first wins. `[InstallDelete]` runs before `[Files]` and is the right hook, but it must name entries precisely: Inno does **not** roll back deletions, so a wildcard wipe of `{app}` would leave an aborted upgrade with nothing installed and `OPENCODE_CONFIG_DIR` pointing at a directory that no longer exists.

## Risks / Trade-offs

- **Junction creation fails (filesystem doesn't support reparse points, e.g. a FAT32 or network target).** → Detect at install; fall back to the current flat layout for that machine rather than failing the install. `DefaultDirName` is under `%LOCALAPPDATA%`, so this is rare but not impossible.
- **Uninstall deleting *through* the junction.** Removing a junction with a naive recursive delete can delete the target's contents. → Remove the junction with `rmdir` (which unlinks the reparse point only), then remove version directories. Covered by the gate's leftover assertion.
- **Disk: ~200 MB per retained version.** → Accepted, capped at 2. Delta updates are a separate concern if it ever matters.
- **Something records a versioned path we didn't audit** (an editor setting, a user's own script, a cached resolution). → The proposal enumerates every installed feature; each is asserted in the gate. A path we missed shows up as a broken feature after the *second* update, which is why the gate runs two consecutive updates.
- **The Electron desktop resolves resources relative to its own location.** → It runs from inside the version directory, which is self-consistent; only its shortcut/login-item entry point goes through `current`.
- **`{app}\current` open in a shell or Explorer blocks repointing.** → Repoint is `rmdir` + `mklink /J`, which fails if the junction itself is the working directory of a process. Retry briefly, and log clearly; unlike today's failure this leaves the previous version fully working.

## Migration Plan

1. Land the layout behind the existing stopgap (both active).
2. Run the lifecycle gate **with editors open and `volt-lsp-iec.exe` running** — the condition that previously forced a rollback. Zero problems required.
3. Ship one dev-channel release; confirm on a machine that already has a flat install that the migration removes the flat payload and `volt` resolves to the new version.
4. Remove `PrepareToInstall`/`CurUninstallStepChanged` process termination; re-run the gate. If it still passes with editors open, the mitigation was genuinely redundant.
5. Record in `installer/README.md` that no path outside `{app}` may ever contain a version number — that invariant is the whole design.

**Rollback:** revert to installing into `{app}` directly and restore the process-kill. The environment values do not change shape (`{app}\current\bin` → `{app}\bin`), so a revert rewrites them once and is otherwise uneventful.
