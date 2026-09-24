## ADDED Requirements

### Requirement: A bridge only ever dials OUT
Volt SHALL NOT open a listening socket. The tunnel SHALL be an outbound WebSocket opened by the bridge to a
configured URL. Absent configuration, a bridge SHALL behave exactly as it does with no tunnel code at all.

#### Scenario: No sidecar present
- **WHEN** a host starts and no `volt-relay.json` sits beside it
- **THEN** no tunnel is started, no socket is opened, and the pipe host behaves identically to today

#### Scenario: Malformed sidecar
- **WHEN** `volt-relay.json` exists but is not valid JSON, or is missing `url` or `token`
- **THEN** the host fails loudly at start, naming the file, rather than starting a local-only bridge

### Requirement: The tunnel is a pipe client, not a second entry point
`Volt.Relay` SHALL reach the engine through the local named pipe, as an ordinary `PipeClient`, and SHALL NOT
call the dispatcher, a service or a driver directly. Every guard that applies to a local client SHALL apply
unchanged to a tunneled request.

#### Scenario: A guard added to the pipe host covers the tunnel
- **WHEN** a request arrives over the tunnel for a bridge whose project is not connected
- **THEN** it is refused with the same `PLC_DISCONNECTED` the CLI would receive, from the same guard

### Requirement: The op allowlist is enforced by the bridge
A tunneled request naming anything outside `health`, `logs`, `refs`, `fetch`, `push`, `build` SHALL be answered
`BAD_REQUEST` without touching the pipe. `connect` and `disconnect` SHALL NOT be reachable over the tunnel.

#### Scenario: Remote connect is refused
- **WHEN** a relay sends `{"id":"r1","op":"connect","body":{"project":"Other"}}`
- **THEN** the bridge answers `{"id":"r1","error":{"code":"BAD_REQUEST",…}}` and the served project is unchanged

#### Scenario: Unknown op
- **WHEN** a relay sends an `op` that is not in `Ops`
- **THEN** the bridge answers `BAD_REQUEST` and no pipe connection is opened

### Requirement: Every accepted request gets exactly one terminal frame
For each request `id` the bridge accepts, it SHALL emit zero or more `progress` frames followed by exactly one
`result` or `error` frame — or the socket SHALL close. A request SHALL NOT be silently dropped, and a failure
SHALL carry a code rather than prose.

#### Scenario: Pipe call fails mid-request
- **WHEN** the local pipe closes while a tunneled `push` is in flight
- **THEN** the bridge answers that `id` with `error.code` `INTERNAL_ERROR` and a message naming the cause

#### Scenario: Socket drops with a request in flight
- **WHEN** the WebSocket closes before a terminal frame is sent
- **THEN** the bridge abandons the request, does not re-run it, and does not answer it on the next connection

#### Scenario: A rejected push is not an error
- **WHEN** a tunneled `push` is rejected by the version gate
- **THEN** the bridge answers with `result` carrying `accepted:false` and `conflicts`, not with an `error` frame

### Requirement: Frames are tagged and may interleave
Every frame after the handshake SHALL carry the `id` of the request it belongs to. Frames for different ids MAY
interleave; order SHALL be guaranteed only within one id.

#### Scenario: health answers while a push holds the IDE
- **WHEN** a `health` request arrives while a tunneled `push` is running
- **THEN** the `health` terminal frame is sent before the `push` terminal frame

### Requirement: The handshake states the protocol version
The bridge's first frame on every connection SHALL be `hello`, carrying `protocol`, `volt`, `vendor` and `pipe`.
There SHALL be no negotiation: a relay that does not speak the version closes the socket.

#### Scenario: Reconnect re-announces
- **WHEN** the tunnel reconnects after a drop
- **THEN** `hello` is sent again as the first frame of the new connection

### Requirement: Liveness is the bridge's responsibility
The bridge SHALL send `{"ping":<n>}` every 25 s and SHALL close and reconnect after 60 s with no frame from the
relay. Reconnect SHALL use capped backoff.

#### Scenario: Relay goes silent
- **WHEN** no frame arrives from the relay for 60 s
- **THEN** the bridge closes the socket and reconnects with backoff, and in-flight requests are abandoned

### Requirement: The token never reaches a log
The relay token SHALL NOT appear in any log file, at any level, on any path — including tunnel start, reconnect
and a failed handshake. The relay URL's host MAY be logged.

#### Scenario: Handshake rejected
- **WHEN** the relay refuses the upgrade with 401
- **THEN** the log records the failure and the host, and does not record the token or the sidecar's contents

## ADDED Requirements

### Requirement: `logs` is a pipe op
The tail of the host's own log SHALL be reachable as `logs`, a member of `Ops` served by the pipe host — not a
tunnel-only side door. It SHALL be answerable while the IDE thread is busy and while the bridge is paused by
`disconnect`.

#### Scenario: logs answers during a long push
- **WHEN** `logs` is called while a `push` holds the IDE thread
- **THEN** it answers from the file without waiting for the push

#### Scenario: logs answers while disconnected
- **WHEN** the bridge is paused by `disconnect` and `logs` is called
- **THEN** it answers, because a disconnected bridge is precisely one whose logs are wanted

#### Scenario: No log file yet
- **WHEN** logging has never written a file
- **THEN** `logs` answers `{ "text": "", "files": [] }` — a real answer, not an error

#### Scenario: Log file unreadable
- **WHEN** a log file exists but cannot be read
- **THEN** `logs` fails with `INTERNAL_ERROR` naming the file, rather than returning an empty string

## ADDED Requirements

### Requirement: `refs` lists library signature items
`refs` SHALL include library signature items in `items` and `folders`, so a client can enumerate the project's
referenced libraries from the snapshot alone. `refs` SHALL NOT render signature bodies — bodies remain `fetch`.

#### Scenario: Libraries appear in the snapshot
- **WHEN** a client calls `refs` on a project with library references
- **THEN** each library's items appear in `items` with a version and in `folders` with the folder they are written to

#### Scenario: refs stays the cheap op
- **WHEN** `refs` runs on a project with many referenced libraries
- **THEN** no signature body is rendered, and the push receipt built from the same walk pays no rendering cost

#### Scenario: One version basis across views
- **WHEN** the same project state is read by `refs` and by `fetch`
- **THEN** a library item's version is identical in both, so `ifVersion` on a library item cannot mis-fire
