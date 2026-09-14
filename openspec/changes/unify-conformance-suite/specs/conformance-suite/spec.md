## ADDED Requirements

### Requirement: One case list for the LSP and the transpiler

The conformance suite SHALL hold every recorded case in one list under `test/conformance/fixtures/`, and both the LSP
replay and the transpiler replay SHALL read that list. No second case list SHALL exist for either tool.

#### Scenario: a new fixture reaches both tools

- **WHEN** a fixture is added and recorded
- **THEN** the LSP replay checks it against its build recording and the transpiler replay against its run recording

### Requirement: Every case that builds is also run

Every case whose source CODESYS builds SHALL have a run recording: every variable reachable from PLC_PRG — its own and
each instance's members — after the case's scan cycles. The variable list SHALL be derived from the parsed fixture, and
the recorder and the replay SHALL use the same derivation.

#### Scenario: an FB fixture records its instance's members

- **WHEN** a fixture declares an FB and instantiates it in PLC_PRG as `inst`
- **THEN** its run recording holds a value for each of the FB's variables under `inst`

### Requirement: Each recording has one recorder

Each recording file SHALL be written by exactly one recorder and hold one level: the bridge recorder writes the build
recordings (diagnostics, per vendor) and the simulator recorder writes the run recording. No recorder SHALL write another
recorder's file.

#### Scenario: recording runs leaves the build truth alone

- **WHEN** `record:exec` records runs
- **THEN** only `recordings/codesys.run.json` changes

### Requirement: Consumers check the level they understand

The LSP replay SHALL check every case that has a build recording, and SHALL report an error containing the recorded
fragment for every case marked `refused`. The transpiler replay SHALL, for every case with a run recording, either require
the interpreter and the emitted Rust to equal every recorded value — when the case lowers — or report a todo naming the
lowering code when it does not. It SHALL NOT run a case marked `refused`.

#### Scenario: a valid program is a false-positive check

- **WHEN** a program case compiles in CODESYS and its build recording holds no diagnostics
- **THEN** the LSP replay fails if the LSP reports any error or warning for it

#### Scenario: a case the transpiler cannot lower yet

- **WHEN** a fixture instantiates an FB and lowering refuses it with `stmt-call_stmt`
- **THEN** the transpiler replay reports a todo naming `stmt-call_stmt`, and it neither passes nor fails

#### Scenario: a case that lowers must agree

- **WHEN** a case lowers and the interpreter or the emitted Rust differs from a recorded value
- **THEN** the transpiler replay fails

### Requirement: Transpiler coverage over the suite only rises

The transpiler replay SHALL report how many cases lower and match CODESYS, and SHALL fail when that number falls below a
recorded floor.

#### Scenario: a change stops a case from lowering

- **WHEN** a lowering change turns a matching case into a todo
- **THEN** the replay fails on the floor until the case lowers again or the change is justified and the floor lowered deliberately

### Requirement: The migration preserves every test

Moving the execution cases into the suite SHALL leave every test's title and result unchanged, proven by comparing a
snapshot of `title → status` taken before the move with one taken after. A difference SHALL be corrected in the migration,
never by changing an expectation.

#### Scenario: a test changes status during the move

- **WHEN** the after-snapshot shows a test that passed before as failing
- **THEN** the move is not committed until the migration is corrected
