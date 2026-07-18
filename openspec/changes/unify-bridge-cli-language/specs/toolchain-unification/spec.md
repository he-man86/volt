## ADDED Requirements

### Requirement: The C# `volt` port preserves behavior, proven by a black-box parity net

The `volt-git` → C# port SHALL be a behavior-preserving port, not a reinterpretation. Before any C# is written, a
**black-box** test suite SHALL exist that drives the `volt` **binary** (spawn + assert on `--json` stdout, exit
code, resulting git state, and bridge `/refs` state) and SHALL be proven green on the current TypeScript CLI
against BOTH bridges. The C# CLI SHALL keep that identical suite green against both bridges. The `--json` shapes,
exit codes, and `VOLT_PROGRESS` stderr format `volt-control` consumes SHALL match byte-for-byte.

#### Scenario: The port is accepted only on identical behavior
- **WHEN** the C# `volt` replaces the TS `volt`
- **THEN** the same black-box parity suite passes against the live CODESYS and TwinCAT bridges, and the
  `--json`/exit-code/progress fixtures captured from the TS CLI still match

#### Scenario: The merge engine is verified against data loss
- **WHEN** `buildVoltIdeTree`'s "unchanged items come from the parent tree, not HEAD" invariant is ported
- **THEN** a black-box roundtrip that edits locally, pulls an unrelated IDE change, and pushes confirms the local
  edit is neither stranded nor folded into the IDE baseline — on both bridges

### Requirement: One shared wire contract over a named pipe

After the port there SHALL be a single definition of the wire (the `Core` DTOs); the TypeScript zod re-declaration
and the `WIRE_VERSION` symmetry check SHALL be removed. The transport SHALL be a **Windows named pipe** (replacing
the HTTP server), carrying the same newline-delimited-JSON frames (`{"progress":…}*` then one
`{"result":…}`/`{"error":…}`), so the streaming and `activeOp` busy-signal semantics are unchanged. CODESYS still
requires a process boundary (its object model is reachable only inside CODESYS.exe); the pipe is that boundary. The
CLI SHALL be a pipe client that consumes the `Core` DTOs directly.

#### Scenario: Adding a wire field is a one-language edit
- **WHEN** a new field is added to a wire response
- **THEN** it is defined once in the `Core` DTO and consumed by both the bridge and the CLI, with no second
  hand-written schema and no `WIRE_VERSION` lockstep to update

#### Scenario: The pipe carries the same protocol the HTTP wire did
- **WHEN** a long op (fetch/init/push/build) runs over the pipe
- **THEN** the client receives zero or more progress frames then exactly one result/error frame, a concurrent
  `/health` call is served (not blocked behind the op), and it reports the in-flight op's `activeOp`

### Requirement: Distribution and update path are unchanged by the port

The C# `volt` SHALL ship as a .NET binary in the existing payload, sharing the runtime already shipped for
`VoltConnector.exe`, and Bun SHALL be dropped from the `volt` build. The single Inno Setup installer and the
connector's `Updater.cs` auto-update path SHALL require no change. `volt status` cold-start (editor-polled via
`volt-control`) SHALL be measured (NativeAOT/ReadyToRun) and SHALL NOT materially regress versus the Bun binary.

#### Scenario: The installer and updater are untouched
- **WHEN** the C# `volt` is bundled
- **THEN** `installer/Volt.iss` and `Updater.cs` are unchanged, the payload gains no new runtime (it reuses the
  connector's), and the measured `volt status` cold-start is recorded and within the accepted bound
