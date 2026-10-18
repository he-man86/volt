## Why

The installer ships an x64 TwinCAT worker that reads a 32-bit XAE's Solution Explorer through a separate x86 helper,
`VoltTwincatExplorer.exe` (its own project, a stdin/stdout protocol, a second process per worker). The reason is real
(DIALECT C2t: the hierarchy proxy `msenvp.dll` must match the READER's bitness and TwinCAT ships only the x86 copy), but the
helper is not the only answer: `TcHierarchy.ReaderFor` already reads in-process when the worker has the XAE's bitness, and
`build-cli.ps1` [3b] already publishes an x86 single-file worker that PLCAssist ships with no helper. Owner (2026-10-17):
"this looks like the correct way".

## What Changes

- The connector launches the worker of the XAE's bitness (`IsWow64Process` on the XAE pid): x86 for TcXaeShell (4024), x64
  for TcXaeShell64 (4026). Both read the hierarchy in-process.
- `Volt.Ide.Twincat.Explorer`, the `X86Helper` reader, its serve protocol and their gates are deleted.
- One TwinCAT worker build per bitness, the same single-file the installer and PLCAssist ship.

## Impact

`Volt.Ide.Twincat` (TcHierarchy), `Volt.Connector(.Core)` (worker launch), `scripts/build-cli.ps1`, the installer payload,
`ide.ps1`, DIALECT C2t, ARCHITECTURE/README (which also say net48 for the helper; it is net472), Repo.Gates.
