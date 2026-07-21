## ADDED Requirements

### Requirement: Every running CODESYS is its own bridge on its own pipe

Because the CODESYS bridge loads in-proc inside each running IDE (InIdeLoad), each activated CODESYS SHALL serve
its OWN named pipe `volt.bridge.codesys.<pid>` — never one shared `volt.bridge.codesys`. Multiple CODESYS SHALL
coexist without colliding, and clients (the connector and the `volt` CLI) SHALL discover the live set by
enumerating the pipe namespace. TwinCAT SHALL keep its single supervised worker on `volt.bridge.twincat`, which
already multiplexes every running project via the COM Running Object Table. This asymmetry is deliberate and SHALL
NOT be unified.

#### Scenario: Two CODESYS activated at once each get a distinct pipe
- **WHEN** the activation script runs inside two different CODESYS instances
- **THEN** each in-proc host serves `volt.bridge.codesys.<pid>` for its own process, both pipes are live at the same time, and neither overwrites the other

#### Scenario: Clients discover the live CODESYS set
- **WHEN** the connector or CLI needs the running CODESYS bridges
- **THEN** it enumerates the pipe namespace for `volt.bridge.codesys.*` (self-cleaning — a pipe dies with its process), rather than assuming a single well-known pipe

### Requirement: One active connection above the connector, vendor-neutral

Above the connector (the `ConnectionManager`, the tray, and the control plane) the model SHALL be a single active
connection across all vendors — one selected project at a time. Connecting any project SHALL make it THE active
connection and clear any prior selection. A **Disconnect** action SHALL clear the active connection WITHOUT tearing
down any host: every activated CODESYS and running TwinCAT project SHALL stay live and re-connectable, so switching
is just another connect.

#### Scenario: Connecting a second project switches the single active connection
- **WHEN** one project is connected and the user connects a different project (any vendor)
- **THEN** the newly-connected project becomes the one active connection and the previous one is deselected

#### Scenario: Disconnect deselects but leaves every host live
- **WHEN** the user chooses Disconnect
- **THEN** there is no active connection, yet every previously-listed project remains detected and connectable (no pipe is torn down)

### Requirement: The CLI targets the bound project's bridge, never the wrong IDE

For CODESYS, with multiple live IDEs the `volt` CLI SHALL resolve the target bridge from the workspace binding —
selecting the live pipe whose project matches the bound project name. With exactly one CODESYS live it SHALL use
it; with several it SHALL match by name; on zero matches or an ambiguous (same-name) match it SHALL REFUSE with a
clear message rather than operate on an arbitrary IDE. An explicit `VOLT_PIPE` SHALL always override (dev, tests,
and `volt init`, which has no binding yet).

#### Scenario: Two CODESYS live, each workspace hits its own IDE
- **WHEN** two CODESYS are open serving two different projects and `volt pull`/`push`/`status` runs in a workspace bound to one of them
- **THEN** the CLI resolves the pipe serving the bound project and operates on that IDE only

#### Scenario: Ambiguous or absent bound project is refused, not guessed
- **WHEN** the bound project is open in two CODESYS at once, or is open in none while others are running
- **THEN** the CLI refuses with a clear message and performs no bridge operation

### Requirement: Connection status is per-workspace

Each frontend's bound-workspace connection status SHALL reflect whether THIS workspace's bound project is live (its
host is serving), not the connector's single global active highlight. Two frontends bound to two different projects
SHALL each show their own connection correctly. For TwinCAT the status match SHALL use the binding name (the
vendor's reported project name), not the PLC sub-project display name.

#### Scenario: Two windows on two projects each show connected
- **WHEN** two editor windows are each bound to a different live project and only one is the connector's active highlight
- **THEN** both windows show their own bound project as connected

#### Scenario: TwinCAT status matches on the binding name
- **WHEN** a workspace is bound to a TwinCAT project whose PLC sub-project display name differs from the project name
- **THEN** the bound-status lookup matches on the project name the binding stores, so the connected workspace is not misreported as disconnected
