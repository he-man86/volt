## ADDED Requirements

### Requirement: one data-driven probe re-measures every marked vendor fact

Volt SHALL have exactly one vendor-fact probe script, driven by a table of item types × facts, with one probe core per
vendor behind the same interface. Adding an item type or a fact SHALL be one table row and SHALL NOT add a code path or
a script. The probe SHALL run only on its own `ide.ps1` fixture instance, against a copy of a committed fixture.

#### Scenario: a new vendor question
- **WHEN** a developer needs to know a new vendor fact
- **THEN** they add a row to the table and re-run the one script, and no new probe script is added to `scripts/`

#### Scenario: a pipe the instance does not own
- **WHEN** the probe is started with a pipe no `ide.ps1` instance owns
- **THEN** it refuses, naming the pipe, and touches nothing

### Requirement: the snapshot is a reviewed baseline

The probe SHALL write every fact into one plain JSON snapshot per vendor with sorted keys, committed to the repository.
A run SHALL compare its result with the committed snapshot and fail on any difference, naming the fact and both values;
the committed snapshot SHALL change only through an explicit write.

#### Scenario: a new IDE build changes a fact
- **WHEN** a new CODESYS service pack or TwinCAT build answers a fact differently
- **THEN** the run fails naming that fact and its committed and measured values

#### Scenario: nothing changed
- **WHEN** the IDE answers every fact as committed
- **THEN** the run passes and the snapshot file is not modified

### Requirement: every re-measurable DIALECT row is in the table

Every `DIALECT.md` row marked as a re-measurable vendor fact SHALL have a row in the probe table, and every table row
SHALL cite a `DIALECT.md` row that exists. An offline Repo.Gates check SHALL enforce both directions.

#### Scenario: a marked row without a probe
- **WHEN** a `DIALECT.md` row is marked re-measurable and no table row names its fact
- **THEN** the Repo.Gates check fails naming the row

#### Scenario: a table row citing nothing
- **WHEN** a table row cites a DIALECT row id that does not exist
- **THEN** the Repo.Gates check fails naming the table row
