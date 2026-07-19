## Why

The bridge (`packages/volt-bridge`, **C#**) and the `volt` CLI (`packages/volt-git`, **TypeScript**) always ship
together — the CLI is useless without a bridge and the bridge exposes nothing without the CLI. Yet they are two
languages joined by an HTTP wire, which forces us to define the same contract **twice**: the C# DTOs in
`Volt.Bridge.Core/Wire/*` and the TS zod schemas in `volt-git/src/bridge/types.ts`, kept in lockstep by a manual
`WIRE_VERSION` and a symmetry check. Every wire change is a two-language edit (this session's `activeOp` field
touched `HealthResponse.cs`, `types.ts`, and `openapi.yaml`). The item-kind ↔ extension mapping is likewise split
across C# (`ItemKind`/`item-kinds.json`) and TS (`domain/extensions.ts`). One language would collapse both
duplications and let bridge + CLI share domain code directly.

The `design.md` works the options; the **decision is Option A — port `volt-git` to C#**, and — per a subsequent
call — **replace the HTTP wire with a Windows named pipe**. What settles the language: the product **already
ships .NET** — `VoltConnector.exe` (the always-on tray supervisor) hosts the auto-updater and the bridges are
net8/net48, so the Bun `volt` binary is the only non-.NET shippable. A C# `volt` shares that runtime, drops Bun
from the payload, and reuses `Core`'s DTOs + kind registry directly.

The work is built in a **new parallel package `packages/volt-cli`**, leaving `packages/volt-bridge` and
`packages/volt-git` untouched as the shipping backup until the port replaces them. See `design.md` for the layout.

## What Changes

- **New `packages/volt-cli`** (C# solution): `Volt.Cli.Transport` (named-pipe RPC), `Volt.Cli.Host`
  (pipe → Core services), `Volt.Cli.Sync` (the port of `volt-git/src`), `Volt.Cli` (the `volt` exe). It
  *references* `Core` (read-only reuse) — killing the C#↔TS wire duplication and the `ItemKind`↔`extensions.ts`
  duplication (one contract).
- **Named pipe replaces HTTP.** Same newline-delimited-JSON frames (`{"progress":…}*` then one
  `{"result":…}`/`{"error":…}`), so streaming + the `activeOp` busy signal port over unchanged; less machinery,
  no listening socket. CODESYS still needs a process boundary (unreachable outside CODESYS.exe); the pipe is that
  boundary.
- **Drop `volt log`** — legacy; no GUI consumes it, and it's a thin wrapper over `git log refs/remotes/volt/ide`
  (the whole point of the remote-tracking-ref model).
- **Black-box parity net** — spawn the `volt` binary, assert `--json`/git/bridge state — the oracle the port keeps
  green (a `VOLT_PIPE` override points the binary at a scratch pipe).
- **Measure NativeAOT/ReadyToRun cold-start** for `volt status` (editor-polled) before shipping.

## Impact

- Ports ~2,800 LOC of TS (git plumbing, the git-native sync/merge engine, the CLI) to C#. The merge engine
  (`buildVoltIdeTree`) is correctness-critical (silent-data-loss risk) and gates on re-greening live roundtrips.
- `volt` distribution: Bun single-binary → .NET binary sharing the connector's runtime; **installer + updater
  unchanged** (same Inno Setup + `Updater.cs`); likely a smaller payload. The connector's worker probe migrates
  HTTP → pipe at cutover.
- The frontends' `--json` contract becomes C#↔TS instead of TS↔TS (a stdout contract, not a live wire).
- Affected at cutover: `packages/volt-git` (retired), `volt-config/tool` (drops `log`; targets the new binary),
  the CI wire-symmetry check (dropped — one definition), and the `volt` build/dist. `volt-lsp-iec`,
  `volt-control`, `volt-desktop`, `volt-vscode` unaffected in language (they spawn `volt`).
