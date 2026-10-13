## Why

A field bug (2026-10-13, `twincat-x64-solution-explorer-marshaling`): the TwinCAT bridge failed on every plain TwinCAT
install because the x64 worker needed a COM proxy only Visual Studio registers — and every test passed, because the dev
machine has Visual Studio. The owner: look for other hidden dependencies and 32/64-bit issues on both systems; "these
locales are definitely a thing" (a Turkish-locale bug in IronPython before; a TwinCAT customer in Russia); "do we have
these in our tests?" — yes, they must be.

A read-only audit (2026-10-13) found, besides the field bug (fixed on branch `hotfix/tc-hierarchy-x86`, which also takes
the cheap breaks: LSP baseline CPU target, installer architecture gate, tr-TR regexes, VoltLog/descriptor invariant
formats, `TcXaeShell64` detection):

- **Breaks on a plain machine — git.** `Volt.Cli/Sync/Git.cs:60,397,418` runs `git` (≥2.28 for `init --initial-branch`,
  `:215`); nothing ships or checks it, so on a CODESYS/TwinCAT-only PC every `volt init/pull/push/status` — and desktop
  sync and agents through volt-control — fails with a bare "cannot find the file". No `safe.directory` (git ≥2.35.2
  refuses a repo owned by Administrators or on a share) and no `core.longpaths` (deep `Library Manager/…` under OneDrive).
  **Owner decision 2026-10-13: bundle MinGit** (Git for Windows' official redistributable) **for the full CLI install only** —
  not in the bridge packages PLCAssist distributes (the bridge never runs git: "git should only be bundled for the
  complete CLI, not for what PLCAssist uses").
- **Breaks in a configuration:** the IDE elevated while Volt is not (TwinCAT: an elevated XAE's ROT entries are invisible,
  `RotInstances.cs:111-133`; CODESYS: the pipe's default DACL, `Volt.Wire/PipeServer.cs:78,157`); a 64-bit TwinCAT shell
  (4026, `TcXaeShell64`) never measured, its hierarchy read unknown; localized TwinCAT build output parsed in English
  (`TcObjectModel.Build.cs:264-266, :419-437`); unsigned exes in a user-writable path vs AppLocker/WDAC; non-ASCII
  `%TEMP%` paths handed to XAE (`TcItemArchive.cs:109`, `TcObjectModel.cs:627`); WMI disabled breaks the installer's
  process step (`Volt.iss:159-161`).
- **Never tested:** 32-bit CODESYS (being installed on the dev machine; `ide.ps1:599` resolves only `Program Files`),
  CODESYS 3.5.17.20 (field only), Windows 10 LTSC 2019 (.NET Framework 4.7.2), non-admin users, Cyrillic user names,
  CODESYS activation in non-Professional/OEM IDEs (English menu hints, `Connector/CodesysActivation.cs:56`).
- **No test covers locale or bitness at all**, and nothing stops a culture-sensitive operation from being added.

## What Changes

- **Git bundled:** MinGit in the payload (`bin\git\`), the CLI always runs that copy (no PATH lookup), with
  `safe.directory` and `core.longpaths` set per call; license and source pointer shipped (GPLv2); the installer and
  `test:install` assert it.
- **Elevation named:** an elevated IDE detected (a TcXaeShell process the ROT cannot see; pipe access denied) and reported
  by name; a PipeSecurity for the CODESYS pipe that admits the same user unelevated (measured, not guessed).
- **TwinCAT 64-bit shell and localized output:** the 4026 hierarchy read measured (manifest? registration?) and handled
  without Visual Studio; build output parsed language-neutrally (or what is lost stated); Cyrillic temp paths measured.
- **CODESYS 32-bit and version span:** `ide.ps1 -CodesysBitness 32|64` (or both roots resolved, an ambiguous version
  refused); the e2e harness records bitness; e2e on 32-bit SP18/21/22; activation hints per feature set/locale.
- **Tests, three layers (owner: "do we have these in our tests"):**
  1. *Offline, in CI on every push:* the C# suites (net10 AND net48 — the CODESYS path runs in-proc on net48) and the LSP
     suite re-run under tr-TR, ru-RU, de-DE; a repo gate forbidding culture-sensitive case/compare/format operations in
     product code (C#, TS, the shipped Python), with the invariant replacements; bitness/target gates on every shipped
     binary (PE machine, the LSP's baseline CPU target, net48 helper on 4.7.2); a gate that no shipped path loads a
     developer-tool-only component.
  2. *Live on the dev machine, as the release gate:* one script runs e2e over every installed variant (CODESYS SP span ×
     32/64-bit, TwinCAT 4024 x86 shell and 4026 x64 shell if installed, parity suite) under customer conditions (no VS
     marshaling — the dev machine keeps the 64-bit msenvp registration removed) and prints the matrix; a release refuses
     a red cell.
  3. *VM cells before a release that touches the bridge or installer:* a TwinCAT-only 4024 VM (the field bug's machine),
     tr-TR/ru-RU system locale with the real IDEs, Windows 10 LTSC 2019, a non-admin user with a Cyrillic name, no git
     on PATH, a CPU without AVX2 — a documented, repeatable checklist (`scripts/README.md`).

## Impact

`packages/volt-cli` (CLI git, Wire pipe security, Connector elevation detection, TwinCAT driver/build parsing, ide.ps1,
Repo.Gates), `scripts/` (payload: MinGit, matrix script, gates), `installer/`, CI (`ci.yml` culture runs), docs. Runs
after the current chain (it touches the bridge and installer the chain also touches), except what the hotfix branch takes.
