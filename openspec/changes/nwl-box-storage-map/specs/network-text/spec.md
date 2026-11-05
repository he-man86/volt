## ADDED Requirements

### Requirement: every stored box state has a pull that loses nothing that changes the program
A pull of a box SHALL show a text that builds and runs as the stored box does, or refuse the network by name. Two stored states the IDE builds or runs apart SHALL NOT pull as one text. A state the editor draws apart from another and that pulls as the same text SHALL be named in the committed list of lost pictures, so a new one fails.

#### Scenario: a consumed FB holding no null
- **WHEN** a consumed FB or PROGRAM box's output list holds no null, which the IDE does not build
- **THEN** the pull shows `%UNSUPPORTED "a consumed box storing no main output"`, never `y := t2(a := a).q1;`

#### Scenario: a state the recording does not know
- **WHEN** a change to the reader or the writer makes a recorded state pull another text
- **THEN** the offline test over `box-states.3.5.21.40.json` fails naming the state

### Requirement: a pushed PROGRAM box stores what the editor's insert stores
A push SHALL store a PROGRAM box's declared output names and the output list the editor's own insert gives it, at a root and consumed, so that a consumed one builds and runs.

#### Scenario: a program read by its output
- **WHEN** `k := p(a := a).q2;` is pushed on CODESYS
- **THEN** the box stores its names with the null at `q2`'s slot, and the build and the run give `k` the output's value

### Requirement: a pushed Execute box runs
A push that writes an Execute box SHALL leave it running: the box's ST reaches the compiler after that one push, with no further commit.

#### Scenario: one push
- **WHEN** a POU holding an Execute box is created by one push
- **THEN** a simulation run shows the box's ST ran
