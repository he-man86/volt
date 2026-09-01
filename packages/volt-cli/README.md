# volt-cli — the Volt toolchain (one C# solution)

The whole PLC toolchain in one package, over Windows **named pipes**: the `volt` CLI (git-native sync), the
two in-IDE bridges (CODESYS / TwinCAT), the tray connector, and the shared `Volt.Engine`. There is no HTTP
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
  Volt.Contracts/           netstandard2.0  the wire CONTRACT — vocabularies (Ops/BridgeErrorCodes/HealthStatus/
                                            Vendors), the request/response DTOs, VoltLog. No ProjectReference,
                                            ever: that is what makes it visible to every assembly, connector
                                            included.
  Volt.Wire/                netstandard2.0  the named-pipe RPC itself (PipeServer/PipeClient/frames/names).
  Volt.Engine/              netstandard2.0  the engine (ST/PLCopen/VG, push/fetch/build/refs, versioning, the
                                            Ide-driver contract) — and NO transport.
  Volt.Engine.Host/         netstandard2.0  BridgePipeHost: op → service, marshalled onto the IDE thread.
  Volt.Cli/                 net8 exe        the `volt` CLI (init/pull/push/status/build/show/merge/rebind) +
                                            Sync/ (git-native client: the volt/ide merge tree, status, materialize)
  Volt.Ide.Codesys/     net48 lib       CodesysDriver + pipe host — loaded in-proc by the CODESYS script host
  Volt.Ide.Twincat/     net8 exe        BeckhoffDriver + the worker the connector spawns (XAE via COM)
  Volt.Connector.Core/  net8 lib        the connector's UI-free model + the TwinCAT worker fleet (unit-tested)
  Volt.Connector/       net8 winexe     the tray shell over that model, and the install/auto-update agent
test/
  shared/FakeIde.cs         the ONE in-memory IDE double, linked into both C# test projects
  Volt.Cli.Tests/           net8 xUnit      the CLI layer — commands/ (every verb × situation), wire/, plumbing/
  Volt.Engine.Tests/        net8 xUnit      the engine — sync/ + the parsing / PLCopen / VG round-trip suites
  Volt.Connector.Tests/ net8 xUnit      connector core: session model, reconciler, TwinCAT supervisor
  e2e/                      bun/TS          the behavioral + vendor-parity suite, driving a live bridge over the pipe
```

Both layers cover the same situation matrix from their own angle: the engine layer (`Volt.Engine.Tests/sync/` + `Volt.Cli.Tests/wire/`) proves each conflict/receipt MECHANISM; the CLI layer (`Volt.Cli.Tests/commands/`) proves the Kind + user-facing message each one produces.

`Volt.Contracts`, `Volt.Wire`, `Volt.Engine` and `Volt.Engine.Host` target `netstandard2.0` so the SAME assemblies
load in the CODESYS net48 host, the net8 TwinCAT host, and the net8 CLI/tests. See `ARCHITECTURE.md` for why the
contract, the pipe and the host are three assemblies and not one.

## Build & test

```bash
dotnet build Volt.sln -c Release                 # the whole toolchain (all TFMs)
dotnet test test/Volt.Cli.Tests/                     # pipe transport + sync + black-box CLI
dotnet test test/Volt.Engine.Tests/                # shared engine
dotnet test test/Volt.Repo.Gates/                    # gates on the repo tree itself
bun test test/unit                                   # offline TS (no bridge)
bun test test/e2e                                    # TS e2e parity suite (set VOLT_PIPE, needs a live bridge)
pwsh scripts/build-cli.ps1                           # publish volt.exe + pipe workers + the connector bundle
```

Headless CODESYS dev loop: `pwsh scripts/codesys-pipe.ps1 up|down|logs` loads the in-proc pipe host into a
headless CODESYS against a fixture project; then `VOLT_PIPE=volt.bridge.codesys bun test test/e2e`.

### Where a test goes

**`test/Volt.X.Tests` tests package `src/Volt.X`. The `test/` root holds only what belongs to no single package.**

```
test/
  Volt.*.Tests/     one pair per src package — same name, same namespace
  Volt.Repo.Gates/  gates on the REPO tree itself; carries NO ProjectReference, deliberately
  e2e/              the live-bridge tier (TypeScript) — items/, connection/, graphical/, endpoints/, …
  unit/             offline TypeScript; this is volt-cli's `test` script, so CI runs it
  shared/           doubles linked into more than one C# suite (namespace `Volt.Tests.Shared`)
  fixtures/         the vendor IDE projects the live tier opens — inputs, not code
```

Two rules keep it that way. A suite's namespace is its project name, with no exceptions — a file that says
otherwise is in the wrong assembly or was moved without being renamed. And a fixture lives in the suite that
reads it: `Volt.Engine.Tests/fixtures/tc-pou/` was opened only by the TwinCAT suite, which reached across for it
through six separate copies of the same directory walk.
