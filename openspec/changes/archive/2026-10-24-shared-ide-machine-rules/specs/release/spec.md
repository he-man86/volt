## ADDED Requirements

### Requirement: a run never starts beside an IDE it does not own
An `ide.ps1 up` SHALL refuse to start while a CODESYS, TcXaeShell or VoltBridgeTwincat process runs that no instance of
its run recorded, naming each such process by pid and command line.

#### Scenario: a foreign IDE is running
- **WHEN** another session's CODESYS runs and a Volt run brings an instance up
- **THEN** nothing starts and the refusal names that CODESYS's pid and command line

#### Scenario: two cells of one run start together
- **WHEN** two instances of run `release-matrix` are brought up at once
- **THEN** neither refuses the other

### Requirement: a run closes what it started on every exit
A run SHALL close its own instances when it ends, fails, throws or is interrupted, and SHALL close them at its start
when a previous run of it was killed before it could.

#### Scenario: a run interrupted with Ctrl+C
- **WHEN** a release matrix run receives SIGINT
- **THEN** every instance it brought up is closed before it exits
