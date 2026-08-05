## ADDED Requirements

### Requirement: A restructure of `volt-cli` changes shape, never observable behavior

A change whose purpose is architectural SHALL be free to move types between projects, add or remove a seam,
split or merge files, and delete an abstraction — and SHALL NOT alter anything a client can observe. Specifically
the pipe wire bytes, the `BridgeErrorCodes` returned for a given failure, the git object SHAs produced for given
content, the `src/` working-tree layout the CLI writes, and the CLI's exit codes and stdout contract SHALL be
identical before and after.

#### Scenario: The live-IDE round trip is unchanged across the restructure

- **WHEN** the e2e parity suite is run against a live headless CODESYS project, and against a live TwinCAT XAE,
  both before the first move and after the last
- **THEN** both runs pass with the same test counts, every item round-trips byte-for-byte, and no test was
  edited to accommodate a move

#### Scenario: A move that requires a test rewrite is rejected

- **WHEN** applying a structural move would require editing a test's assertions to keep the suite green
- **THEN** the move is treated as a behavior change and is deferred with its evidence, not applied — the only
  permitted test edit is a mechanical file move following a type the test covers

#### Scenario: Load-bearing vendor asymmetries survive relocation

- **WHEN** a move relocates code on either side of the `IIdeDriver` seam or below `IProjectSource`
- **THEN** the asymmetries `ARCHITECTURE.md` marks load-bearing — the hosting models, the in-memory vs
  file-based PlcOpen transport, `TcPouReader` having no CODESYS counterpart, Beckhoff's per-node `try/catch` in
  the tree walk, and the host lifecycle difference — remain intact, and no per-vendor difference becomes
  observable to the CLI or connector

### Requirement: A seam exists because it is paid for

Every interface, indirection layer and project boundary in `packages/volt-cli/src` SHALL be justified by a
concrete, present-tense need: more than one real implementation, a process or trust boundary, a vendor
asymmetry that cannot be resolved above it, or a test seam that a fake can satisfy without asserting a false
invariant. Speculative flexibility SHALL NOT be introduced, and an existing indirection that no longer meets
this bar SHALL be removed rather than documented.

#### Scenario: A proposed abstraction has one implementation and no boundary

- **WHEN** a restructure proposes an interface, base class or project split that would have a single
  implementation and cross no process, trust or vendor boundary
- **THEN** it is rejected, and the reason is recorded

#### Scenario: A net-additive target justifies itself

- **WHEN** a proposed target architecture increases total source LOC
- **THEN** the increase is stated and justified explicitly in the change's design record, rather than accepted
  as the cost of structure

### Requirement: A fake that must lie names a misplaced seam

Where a test double has to encode an invariant the real implementation does not hold, that SHALL be treated as
a defect in the seam being faked, not as a property of the test. The seam SHALL be moved or narrowed until the
double can be truthful, and the correction SHALL be demonstrated by a test that fails before the fix and passes
after.

#### Scenario: The fake's invariant contradicts a real driver

- **WHEN** a fake IDE asserts that two signals are the same signal, and a real vendor driver derives them from
  different sources
- **THEN** the divergence is fixed at the seam so both the fake and every driver answer the question once, and
  the previously-green suite goes red before it goes green

### Requirement: The structure of `volt-cli` is written down and current

`packages/volt-cli/ARCHITECTURE.md` SHALL describe the structure that exists — the projects, the layer stack,
each seam and what it earns — and SHALL be updated by the same change that alters any of them. Exactly one
document SHALL hold that map; two documents that can disagree SHALL NOT both be kept.

#### Scenario: A project boundary moves

- **WHEN** a change moves a type between projects or alters a project boundary
- **THEN** `ARCHITECTURE.md` and, where it names the boundary, the repo `CLAUDE.md` package map are updated in
  the same change, and no stale description of the old shape remains

#### Scenario: A contributor needs to know where a decision belongs

- **WHEN** a contributor must decide whether logic belongs in the shared engine, in a vendor host, or in the CLI
- **THEN** the rule is stated in `ARCHITECTURE.md`, not inferred from where similar code happens to sit

### Requirement: Structural change lands in independently green steps

A restructure SHALL be executed as an ordered sequence of moves, each of which builds, passes all three C# unit
suites on its own, and is committed and revertable on its own. A move that can only be green as part of a
larger set SHALL be decomposed until it can stand alone, or deferred. No intermediate state of the repository
SHALL be knowingly red.

#### Scenario: A move cannot stand alone

- **WHEN** a proposed move only compiles or only passes as part of a larger batch
- **THEN** it is decomposed into steps that each pass, or recorded as deferred — it is not applied as a
  big-bang change with a red intermediate state

#### Scenario: A move regresses a suite

- **WHEN** the gate for a move fails to build or fails any of the three C# unit suites
- **THEN** the move is reverted rather than followed by a fix-up commit, and it is re-queued with the failure as
  input
