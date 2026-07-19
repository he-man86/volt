# volt-cli — the Volt toolchain (one C# solution)

The whole PLC toolchain in one package, over Windows **named pipes**: the `volt` CLI (git-native sync), the
two in-IDE bridges (CODESYS / TwinCAT), the tray connector, and the shared `Volt.Cli.Core`. There is no HTTP
server and no separate client/server contract — the CLI, the bridges, and the connector all compile against one
Core and speak one pipe wire.

## Why named pipes

The CODESYS object model lives only inside `CODESYS.exe` (a net48 library the IDE's script host loads), so a
process boundary between the CLI and the in-IDE bridge is unavoidable — but it doesn't need to be a socket. A
local **named pipe** carries newline-delimited JSON frames (`{"progress":…}*` then one `{"result":…}` /
`{"error":…}`) with no listening port: one pipe per live bridge (`volt.bridge.codesys` / `volt.bridge.twincat`),
the CLI and connector are clients.

## Layout

```
src/
  Volt.Cli.Transport/    netstandard2.0  the named-pipe RPC (PipeServer + PipeClient + frames + names). The
                                         Connector references THIS ALONE, so it stays decoupled from the engine.
  Volt.Cli.Core/         netstandard2.0  the bridge engine (ST/PLCopen/VG, push/fetch/build services, versioning,
                                         the Ide-driver contract) + Wire/BridgePipeHost (serves it over the pipe)
  Volt.Cli/              net8 exe        the `volt` CLI (init/pull/push/status/build/show/merge) + Sync/ (the
                                         git-native client: volt/ide merge tree, changeset/status, materialize)
  Volt.Cli.Ide.Codesys/  net48 lib       CodesysDriver + PipeHost — loaded in-proc by the CODESYS script host
  Volt.Cli.Ide.Twincat/  net8 exe        BeckhoffDriver + the worker the connector spawns (attaches to XAE via COM)
  Volt.Cli.Connector/    net8 winexe     the tray supervisor (spawns/monitors the workers; probes `health`)
test/
  shared/FakeIde.cs      the ONE in-memory IDE double, linked into both C# test projects
  Volt.Cli.Tests/        net8 xUnit      the CLI layer — commands/ (every verb × situation), wire/ (pipe + client), plumbing/ (git/tree/status)
  Volt.Cli.Core.Tests/   net8 xUnit      the shared Core — sync/ (push/fetch/refs services) + the parsing / PLCopen / VG round-trip suites
  e2e/                   bun/TS          the behavioral + vendor-parity suite, driving a live bridge over the pipe
```

Both layers cover the same situation matrix from their own angle: the transport layer (`Core.Tests/sync/` + `wire/`) proves each conflict/receipt MECHANISM; the CLI layer (`Tests/commands/`) proves the Kind + user-facing message each one produces.

`Transport` and `Core` target `netstandard2.0` so the SAME assemblies load in the CODESYS net48 host, the net8
TwinCAT host, and the net8 CLI/tests.

## Build & test

```bash
dotnet build Volt.Cli.sln -c Release                 # the whole toolchain (all TFMs)
dotnet test test/Volt.Cli.Tests/                     # pipe transport + sync + black-box CLI
dotnet test test/Volt.Cli.Core.Tests/                # shared Core
bun test test/e2e                                    # TS e2e parity suite (set VOLT_PIPE, needs a live bridge)
pwsh scripts/build-cli.ps1                           # publish volt.exe + pipe workers + the connector bundle
```

Headless CODESYS dev loop: `pwsh scripts/codesys-pipe.ps1 up|down|logs` loads the in-proc pipe host into a
headless CODESYS against a fixture project; then `VOLT_PIPE=volt.bridge.codesys bun test test/e2e`.
