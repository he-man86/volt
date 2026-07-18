## Context

Today the toolchain is split by language along the HTTP wire:

```
volt CLI (TS, Bun binary)  ──HTTP──  bridge (C#)  ──in-proc / COM──  CODESYS / TwinCAT
  git + sync + orchestration          IDE object-model access
```

- `volt-bridge` is **C# and must be** — it is .NET interop with .NET-only IDEs. `Core` targets `netstandard2.0`
  so one binary loads in both hosts:
  - **CODESYS** — `Volt.Bridge.Codesys` is a **net48 library loaded IN-PROCESS** by the IDE's IronPython
    `--runscript` command (`Host.Start()` runs inside CODESYS.exe). CODESYS exposes **no external automation** to
    attach to a running UI.
  - **TwinCAT** — `Volt.Bridge.Beckhoff` is a **net8 standalone exe** that **attaches to a running XAE over COM**.
- `volt-git` is **TypeScript**: git plumbing (`git.ts`), the git-native sync/merge engine (`domain/ide-tree.ts`,
  `status-model.ts`, `sidecar.ts`, `materialize.ts`, `extensions.ts`), the commands, and the CLI. It talks to the
  bridge over HTTP and knows nothing IDE-specific.

The duplication the user wants gone:
1. **Wire contract, twice** — C# DTOs (`Wire/*.cs`) ↔ TS zod (`bridge/types.ts`), lockstepped by `WIRE_VERSION`
   + a CI symmetry check. `openapi.yaml` is a *third* description of the same contract.
2. **Kind ↔ extension mapping, twice** — C# `ItemKind`/`item-kinds.json` ↔ TS `domain/extensions.ts`.

## Goals / Non-Goals

**Goals** — one source of truth for the wire; share domain logic bridge↔CLI; reduce the per-change edit surface;
where possible, collapse a process/HTTP hop.

**Non-Goals** — changing the IDE drivers, the git-native model, or the `volt` command surface. Not touching the
TS frontends' *language* (they spawn `volt` regardless). Not shipping anything this change — decision + spikes only.

## The one constraint that bounds every option

**The CODESYS object model lives only inside CODESYS.exe.** The bridge is loaded there by the IDE's script host;
there is no way for a separate `volt` process to reach the object model. Therefore, for CODESYS, **there is always
a two-process split** — a short-lived `volt` CLI + a persistent in-CODESYS agent — and **some IPC between them is
unavoidable**, in any language. "Remove the HTTP server and just talk over an internal layer" is only fully true
for **TwinCAT** (whose bridge is a standalone process a C# CLI could simply *be*). For CODESYS the win is not
"no IPC" but "same-language IPC that marshals a shared contract instead of a hand-duplicated one," and the HTTP
server could shrink to a thin named-pipe/stdio channel.

This is why **full TS is a non-starter** and the user's instinct toward **C#** is directionally right: the bridge
cannot be anything but .NET, so if we unify, C# is the only language that can host *both* sides.

## Options

### A. Full C# — port `volt-git` to C#  (the user's proposal)
The CLI, git plumbing, and sync engine become C#. Bridge stays C#. Wire DTOs and the kind registry are defined
**once** and shared. TwinCAT: the CLI attaches to XAE in-process → **no separate bridge process, no HTTP**.
CODESYS: the CLI still speaks to the in-proc agent, but over a same-language channel carrying the shared DTOs.

- **Pros** — kills both duplications (#1, #2); one build toolchain (`dotnet`) for bridge+CLI; TwinCAT drops a
  whole process + HTTP; the in-CODESYS agent and the CLI share the item/VG/materialization code that is currently
  reimplemented in TS.
- **Cons** — a real **rewrite of ~2,800 LOC**, including the subtle, well-tested git-native merge model
  (`buildVoltIdeTree` is load-bearing and correctness-critical); **CODESYS IPC does not go away**; `volt` moves
  from a small fast **Bun single-binary to a .NET binary** (self-contained ≈ tens of MB, or NativeAOT for a
  small fast exe — needs measuring for a frequently-invoked CLI like `volt status`); the frontend `--json`
  contract shifts from TS↔TS to **C#↔TS** (one duplication boundary moves rather than vanishes); git access moves
  to LibGit2Sharp or shelling (parity with today's shelling is fine).

### B. Full TS — port the bridge to TS
**Rejected.** The bridge is .NET interop; the CODESYS in-proc host is .NET-only; TwinCAT COM automation from Node
is fragile. Not viable.

### C. Status quo
Two languages, HTTP wire, dual contract. Works and ships. The tax is the per-wire-change two-language edit + the
symmetry check. Baseline to beat.

### D. Keep TS, generate the wire types from `openapi.yaml`  (cheap fix for the *actual* pain)
The pain the user names is contract **drift**, and we already maintain `openapi.yaml` as a third description.
Make it the source of truth: generate the TS zod (or plain types) from it, and assert the C# DTOs against it in
CI. The duplication becomes *generated*, not *hand-written*.

- **Pros** — days, not weeks; removes the drift risk that motivates this; no rewrite, no distribution change, no
  language split. Keeps the clean "bridge = C#, everything else = TS" mental model.
- **Cons** — still two languages and two processes; does **not** share domain logic or collapse the TwinCAT hop;
  adds a codegen step to the build.

### E. Keep TS, replace HTTP with stdio/named-pipe JSON-RPC
Trims the HTTP server to a lighter local transport. Minor; keeps both duplications. Only worth it if HTTP itself
(not the language split) is the problem — it isn't, per the user's framing.

## The distribution finding that settles it

The product **already ships a .NET runtime**: `VoltConnector.exe` (`Volt.Bridge.Connector`, net8-windows) is the
always-on system-tray supervisor that spawns/supervises the bridge workers **and hosts the auto-updater**
(`Updater.cs` polls GitHub + re-runs the one Inno Setup installer). The `volt` CLI is the odd one out — a
`bun --compile` binary. So:

- A C# `volt` **shares the runtime already shipped**; **Bun leaves the payload** (only the LSP stays TS). Likely a
  *smaller* installer, not larger — one fewer embedded-runtime binary.
- **Installer + updater are unchanged**: same Inno Setup, same `Updater.cs`. The CLI just becomes a .NET binary in
  the same payload.
- The connector deliberately talks to workers over **HTTP with no `Core` reference** — a vendor-isolation boundary.
  So **HTTP stays**; the CLI remains an HTTP client but uses `Core`'s DTOs instead of re-declaring them in TS zod.

## Decision

**Adopt Option A (full C#)** and **replace HTTP with a Windows named pipe** (a subsequent call — the pipe is a
cleaner local boundary than an HTTP listener, and CODESYS needs *a* process boundary regardless). The CLI shares
`Core`'s DTOs and kind registry, killing both duplications. Option D (codegen) is **not** chosen — it fixes only
the wire drift and leaves the domain duplication + the split runtime.

### Package structure (built parallel; backups untouched)

```
packages/volt-cli/                       NEW — the unified C# toolchain
  src/Volt.Cli.Transport/  netstandard2.0  named-pipe RPC (PipeServer/PipeClient/frames) — replaces HTTP
  src/Volt.Cli.Host/       netstandard2.0  wires the pipe to Core's services + the activeOp busy signal
  src/Volt.Cli.Sync/       net8            the port of volt-git/src (git, ide-tree, status-model, materialize…)
  src/Volt.Cli/            net8 exe        the `volt` CLI (Program → commands)
  test/Volt.Cli.Tests/     net8 xUnit      pipe + git + domain + command tests (against FakeIde + a real repo)
packages/volt-bridge/  UNTOUCHED backup — Core + drivers reused by reference; migrate in at cutover
packages/volt-git/     UNTOUCHED backup — retired at cutover
```

The transport + host target `netstandard2.0` so the SAME assemblies load in the CODESYS net48 in-proc host, the
net8 TwinCAT host, and the CLI — like `Core`. The two per-vendor **entry-point hosts** (a CODESYS in-proc DLL and
a TwinCAT exe that instantiate the real drivers and start `BridgePipeHost`) are the cutover piece.

Two gates before the port is "safe", not before it's "decided":
1. **Black-box test net** (see Risks) — the current `bun:test` suites are white-box and don't port.
2. **Cold-start measurement** — `volt status` is editor-polled; NativeAOT/ReadyToRun must match Bun closely.

## Risks / Trade-offs — and why this is a behavior-parity PORT, not a free translation

The logic is largely mechanical (git via `Process`, fs → `System.IO`, zod validation → the existing `Core` DTOs),
so the temptation is "1-to-1 port, the tests cover it". They don't — the risk lives in the long tail:

- **The existing tests do NOT carry over.** `volt-git`'s suites (`sync.test.ts`, `live-roundtrip.test.ts`, …) are
  `bun:test` and **white-box** — they `import { pull }` and call TS functions. C# can't be driven by them; the
  safety net must be rebuilt, and a bug in the rebuilt net can hide a regression.
  - **Mitigation (do this FIRST, while the CLI is still TS):** convert the live roundtrip + e2e suites to
    **black-box** — spawn the `volt` binary, assert on `--json` + git state + bridge state — and prove them green
    on today's TS CLI. The bridge e2e is already black-box, so the pattern exists. Then the port keeps the *same*
    tests green against both real bridges: a language-agnostic net that verifies parity, not just "trust the port".
- **`buildVoltIdeTree` / the merge model** is the sharpest edge: its "unchanged items come from the PARENT tree,
  not HEAD" invariant is what stops unpushed edits being stranded. A port bug there is **silent data loss** — it
  must re-green the black-box roundtrips on both bridges.
- **Byte-level parity** the frontends depend on: the `--json` shape (`volt-control` parses it), exit codes, the
  `VOLT_PROGRESS` stderr format, git-output parsing (`ls-tree`, `--name-status`, `\x1f` delimiters), and
  **Windows CRLF/encoding**.
- **Cold-start**: `volt status` runs on every editor poll via `volt-control`; NativeAOT/ReadyToRun cold-start must
  be measured against Bun before shipping — the one axis where the port could regress the user experience.
- **A moves the CLI off the "TS island."** The IDE-facing toolchain (bridge + connector + CLI) becomes one .NET
  solution; LSP + control + desktop + vscode + www stay TS (they spawn `volt`, unaffected). This is arguably the
  *correct* seam — TS where it's web/language-server, C# where it's .NET IDE interop.

## Open Questions

- TwinCAT in-process: is per-invocation XAE attach latency acceptable, or does TwinCAT also need a warm persistent
  agent (re-introducing an IPC hop there too)?
- Does the shared domain code (kind registry, VG, materialization) actually want to run **CLI-side**, or does it
  already live bridge-side such that the CLI only orchestrates? (If the latter, A's "share domain code" win is
  smaller than it looks.)
- Is `openapi.yaml` complete enough to be the codegen source of truth today, or does it lag the DTOs?
