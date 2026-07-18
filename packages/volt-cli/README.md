# volt-cli — the unified C# toolchain (in progress)

The combined **bridge + CLI** in one language, per openspec `unify-bridge-cli-language`. Today `volt-bridge` (C#)
and `volt-git` (TypeScript) are joined by an HTTP wire with a hand-duplicated contract; this package collapses
them onto C# and replaces HTTP with a **Windows named pipe**.

> **The old packages stay in parallel as the backup.** `packages/volt-bridge` and `packages/volt-git` are
> **untouched** — the shipping toolchain — while this is built out. `volt-cli` only *references* the bridge's
> `Volt.Bridge.Core` (read-only reuse, not a fork); when this replaces the toolchain, Core migrates in and the
> backups are retired.

## Why named pipes instead of HTTP

The CODESYS object model lives only inside CODESYS.exe (a net48 library loaded by the IDE's script host), so a
process boundary between the CLI and the in-IDE agent is unavoidable — but it doesn't need to be HTTP. A local
**named pipe** carries the same newline-delimited-JSON frames (`{"progress":…}*` then one `{"result":…}`/
`{"error":…}`) with less machinery and no listening socket. The wire shape is otherwise identical, so clients and
the streaming/`activeOp` semantics port over unchanged.

## Layout

```
src/
  Volt.Cli.Transport/   netstandard2.0  the named-pipe RPC (PipeServer + PipeClient + frames) — replaces HTTP
  Volt.Cli.Host/        netstandard2.0  wires the pipe to the SAME Core services (refs/fetch/push/build + activeOp)
  Volt.Cli/             net8 exe        the `volt` CLI — C# port of packages/volt-git (phase 2, module-by-module)
test/
  Volt.Cli.Tests/       net8 xUnit      the bridge wire tests, reformatted onto the pipe (green — see below)
```

`Volt.Cli.Transport` and `Volt.Cli.Host` target `netstandard2.0` so the SAME assemblies load in the CODESYS
net48 in-proc host, the net8 TwinCAT host, and the net8 CLI/tests — exactly like `Volt.Bridge.Core`.

## Status

- **Done (phase 1):** the pipe transport (server + client), the host wiring to Core's services incl. the
  `activeOp` busy signal, and the bridge wire tests reformatted onto the pipe — all building + passing.
- **Next (phase 2):** port `volt-git/src` (git plumbing → `Process`; the volt/ide merge tree; changeset/status
  model; materialize; kind registry reused from Core) module-by-module, verified by a **black-box parity suite**
  proven green on the TS CLI first. Then the in-proc CODESYS/TwinCAT pipe hosts, and the distribution cutover
  (share the connector's .NET runtime; drop Bun; installer + updater unchanged).

Build/test: `dotnet build Volt.Cli.sln -c Release` · `dotnet test test/Volt.Cli.Tests`.
