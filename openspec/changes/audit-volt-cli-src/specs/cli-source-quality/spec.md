## ADDED Requirements

### Requirement: A refactor of `volt-cli` source is observably behavior-preserving

A change whose purpose is code quality SHALL NOT alter any behavior a client can observe. Specifically, the pipe
wire bytes, the `BridgeErrorCodes` returned for a given failure, the git object SHAs produced for given content,
the `src/` file layout, and the CLI's exit codes and stdout contract SHALL be identical before and after. Any
improvement that cannot meet this bar SHALL be recorded as a follow-up proposal instead of implemented.

#### Scenario: The live-IDE round trip is unchanged

- **WHEN** the audited toolchain is run against a live headless CODESYS project via the e2e parity suite
- **THEN** every item round-trips byte-for-byte and the suite passes with no test edited to accommodate the
  refactor

#### Scenario: A behavior-changing improvement is deferred, not applied

- **WHEN** a review finds an improvement that would change observable behavior
- **THEN** it is recorded with its evidence as a future change, and the working tree carries no part of it

#### Scenario: Load-bearing vendor asymmetries survive the refactor

- **WHEN** a refactor touches code on either side of the `IIdeDriver` seam
- **THEN** the asymmetries `ARCHITECTURE.md` marks load-bearing — the hosting models, the in-memory vs
  file-based PlcOpen transport, `TcPouReader` having no CODESYS counterpart, and Beckhoff's per-node `try/catch`
  in the tree walk — remain intact, and no per-vendor difference becomes observable to the CLI or connector

### Requirement: `volt-cli` source conforms to one written set of conventions

The C# source SHALL conform to one written set of conventions, stated in `packages/volt-cli/ARCHITECTURE.md`:
the single logging path, the single error channel across the wire, the prohibition on defensive defaults that
mask an upstream bug, nullability, and file/partial-class layout. Where an exception is deliberate it SHALL be
marked in the code with its reason rather than left to be re-discovered.

#### Scenario: A missing wire field fails loud

- **WHEN** a wire payload omits a field the receiver requires
- **THEN** the receiver fails with a `BridgeException` carrying an error code, and does NOT substitute a default
  value that lets the operation continue on invented data

#### Scenario: A contributor can find the rule

- **WHEN** a contributor needs to know the project's convention for logging, error propagation, or defaults
- **THEN** it is stated in `packages/volt-cli/ARCHITECTURE.md`, not inferred from surrounding code

### Requirement: The audit of `volt-cli` source is recorded

An audit pass over the source SHALL leave a durable record: for each audited file, the issues found, which were
fixed, which were deliberately skipped and why, and the line count before and after. Architectural observations
that were deliberately not acted on SHALL be recorded separately with enough evidence to become their own
proposals.

#### Scenario: A later reader can reconstruct what changed and why

- **WHEN** someone reads the change after it lands
- **THEN** `ledger.md` shows per-file findings, fixes, skips with reasons, and LOC before → after, and
  `arch-notes.md` lists every deferred architectural finding with its evidence
