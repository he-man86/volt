## ADDED Requirements

### Requirement: the CODESYS start line names the project, the relay and the log directory
The line `PipeHost.Start` returns (printed into the CODESYS message window) SHALL name the project served, or that none
is open; the relay state at start: dialing with its host, not configured, or not started; and the log directory
(`VoltLog.Dir`).

#### Scenario: a project open and a relay configured
- **WHEN** the start script runs with `Line1.project` open and a relay sidecar beside the bridge
- **THEN** the line names `Line1`, that the relay is dialing `<host>`, and the log directory

#### Scenario: no relay configured
- **WHEN** the bundle holds no setup code and no sidecar
- **THEN** the line states the relay is not configured
