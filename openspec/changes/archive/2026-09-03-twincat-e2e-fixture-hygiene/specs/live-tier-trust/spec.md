## ADDED Requirements

### Requirement: The live TwinCAT tier reports the same result for the same code

The TwinCAT e2e suite SHALL produce an identical failure set across repeated runs of unchanged code. A run SHALL
NOT be influenced by how many times the suite has already run against the fixture project. Where that cannot be
guaranteed by cleanup, each run SHALL start from a fresh copy of the fixture, as the CODESYS tier already does.

#### Scenario: Three consecutive runs of unchanged code agree
- **WHEN** the TwinCAT e2e suite is run three times without restoring the fixture in between
- **THEN** all three runs report the same set of failing tests

#### Scenario: A used fixture does not manufacture failures
- **GIVEN** a fixture project that a previous run has already written to
- **WHEN** the suite is run again against unchanged code
- **THEN** it reports the same failures as a run against a freshly restored fixture

### Requirement: A dirty fixture is refused, not silently tolerated

The suite SHALL refuse to start when the fixture project carries uncommitted changes, naming the paths and the
command that restores them. A false failure that looks like a hung bridge costs more than a refusal that names
its cause: the same symptom has been diagnosed wrongly twice.

#### Scenario: The suite refuses a dirty start
- **WHEN** the TwinCAT e2e suite starts against a fixture project with uncommitted modifications
- **THEN** it stops before running any test, and its message names the modified paths and how to restore them
