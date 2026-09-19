## ADDED Requirements

### Requirement: The census is derived from the language, not from the fixtures

The suite SHALL hold a topic tree whose cells come from the LANGUAGE — the elementary-type table, the operator
table, the vendor's reference — and never from the fixtures that exist. A topic with no cells defined SHALL be
listed rather than silently absent, so a question nobody thought of still has a node.

#### Scenario: a question nobody wrote a fixture for is still visible

- **WHEN** the census report runs
- **THEN** it names every cell that has no fixture, and every topic that has no cells at all

#### Scenario: a topic in neither list fails the gate

- **WHEN** a topic is neither defined as cells nor listed as planned
- **THEN** the census gate fails, because that is the state the tree exists to prevent

### Requirement: Every fixture carries how well it is evidenced

Every fixture SHALL carry a rating saying what the vendor answered and whether this implementation agrees:
`confirmed`, `refused`, `not-lowered`, `lsp-gap`, `diverges`, `unaskable` or `unasked`. The rating SHALL be
GENERATED from the recordings by one implementation, and a gate SHALL recompute all of it and fail when a stored
rating disagrees — so a generated file and the gate that checks it can never measure different things.

#### Scenario: a stored rating goes stale

- **WHEN** a change makes the LSP report an error it did not report before
- **THEN** the gate recomputes that fixture's rating and fails until the generated file is regenerated

#### Scenario: a refusal counts as evidence only when both sides refuse

- **WHEN** the vendor rejects a source and this implementation accepts it silently
- **THEN** the fixture is rated `lsp-gap`, not `refused`

### Requirement: A fixture that never reached the compiler is distinguishable from one whose answer is pending

`unasked` SHALL mean "no recording", and it SHALL stay at zero: a fixture is either recorded against a real vendor
or says in its own words why it cannot be. A fixture skipped by the recorder SHALL NOT be indistinguishable from
one whose question is open.

#### Scenario: a fixture the recorder cannot read

- **WHEN** a fixture declares nothing the harness can read back
- **THEN** it carries an `execSkip` naming the reason, and is rated `unaskable` rather than `unasked`

#### Scenario: a fixture added without a recording

- **WHEN** a fixture is added and not recorded
- **THEN** the `unasked` ceiling of zero fails, and the recording is run before it is merged

### Requirement: The recorded message is the fixture's, and the table is the file's

A fixture that records a refusal SHALL carry the vendor's own message fragment, and the FAMILY it belongs to SHALL
carry the whole measured table in its file header — so the reasoning behind an implementation is next to the
measurements it was drawn from, not in a commit message.

#### Scenario: a rule drawn from one sample

- **WHEN** a family's header shows a table with one row per probe
- **THEN** a reader can see which cells the rule rests on, and which of them a later sweep contradicted
