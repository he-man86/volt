## ADDED Requirements

### Requirement: Wire behavior and errors are identical across vendors

For the same project state, both vendor bridges SHALL return byte-identical responses and, on failure, the SAME
`BridgeErrorCodes` string over the pipe. A per-vendor difference that the `volt` CLI (or any pipe client) can observe
is a defect, not a permitted asymmetry — only the IDE-connection layer BELOW the seam (`IIdeDriver`) may differ.

#### Scenario: A select that cannot attach the requested project

- **WHEN** a `select` names a project the driver cannot attach (TwinCAT: it lives in a different XAE window than the
  one bound; CODESYS: the pipe's project no longer matches)
- **THEN** the bridge refuses with the shared `PLC_DISCONNECTED` code on BOTH vendors — never "ok" into a
  not-connected state where the next fetch silently returns zero items

#### Scenario: The same failure yields the same code

- **WHEN** the same failure condition occurs on either vendor
- **THEN** the wire error code is identical, and no vendor-specific exception type reaches the client

### Requirement: Parity-critical decisions live in Core, not in drivers

A decision whose outcome a pipe client can observe (a post-condition, an empty-result judgement, an error mapping)
SHALL have exactly one implementation, in shared Core (`Volt.Engine`), delegating only irreducible primitives to the
driver. A driver MUST NOT be able to override such a decision — the seam exposes primitives, never wire policy.

#### Scenario: The select post-condition is enforced once

- **WHEN** either driver returns from its attach primitive
- **THEN** Core (`BridgePipeHost`) — not the driver — checks the shared connection state and decides the wire outcome,
  so both vendors behave identically by construction

#### Scenario: A new vendor branch above the seam is rejected

- **WHEN** a change introduces a `vendor ==` / vendor-specific branch in Core or connector logic outside the
  sanctioned spots (identity strings, pipe-topology inside `IProjectSource`)
- **THEN** the anti-drift guard fails, so the parity boundary is enforced mechanically rather than by review

### Requirement: A conformance suite proves both drivers honor the contract

The behavior the type system cannot express (post-conditions, error codes, health-signal equivalence, tree-walk
invariants) SHALL be asserted by one suite run against BOTH drivers, so behavioral parity is mechanically verified,
not assumed.

#### Scenario: Both drivers pass the same behavioral assertions

- **WHEN** the conformance suite runs
- **THEN** the same assertions execute against each vendor's driver (offline where a fake/headless IDE is feasible),
  and any COM-only assertions run in the documented e2e tier against a live setup

#### Scenario: IsConnected and health agree on every driver

- **WHEN** a driver reports `IsConnected`
- **THEN** it equals `BuildHealthResponse().Connected` for that driver — the single signal Core's post-conditions
  rely on
