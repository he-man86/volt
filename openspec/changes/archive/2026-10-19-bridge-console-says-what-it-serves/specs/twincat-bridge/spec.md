## ADDED Requirements

### Requirement: a double-click TwinCAT bridge shows its log on the console
A TwinCAT bridge started without `--xae-pid` SHALL write every log line at Info and above to its console as well as to
the log. Started with `--xae-pid`, it SHALL NOT, because its supervisor already writes the worker's stdout to the log.

#### Scenario: a double-click start serves a solution
- **WHEN** a bridge started without `--xae-pid` attaches to an XAE holding solution `Lift`
- **THEN** the log line naming the served solution `Lift` also appears on the console

#### Scenario: a supervised start
- **WHEN** the connector starts the worker with `--xae-pid 1234`
- **THEN** no log line is written to the console by the tee

### Requirement: nothing reports connected before it is
No console or log line of a bridge SHALL say it is connected to the IDE before the attach has served a solution, nor
connected to the relay before the relay has sent a frame on that connection. The line printed when the pipe is up SHALL
state only that the pipe is up and that closing the window stops the bridge.

#### Scenario: an XAE the worker cannot read
- **WHEN** `driver.Unsupported` is set at start (DIALECT C2t)
- **THEN** the console shows that reason, and no line says the bridge is connected to TwinCAT

#### Scenario: the relay socket opens but the relay sends nothing
- **WHEN** the tunnel's socket connects and the relay closes it before any inbound frame
- **THEN** no `relay: connected` line was written for that connection

#### Scenario: the relay accepts
- **WHEN** the first inbound frame of a connection arrives
- **THEN** one `relay: connected to <host>` line is written for that connection

### Requirement: an unconfigured relay is stated
`PipeHostTunnel.StartIfConfigured` SHALL log that the relay is not configured when there is neither a sidecar nor a setup
code, through the log it is given.

#### Scenario: a copy with no relay configured
- **WHEN** the bundle holds no setup code and no relay sidecar
- **THEN** the log, and on a double-click start the console, has the line `relay: not configured`
