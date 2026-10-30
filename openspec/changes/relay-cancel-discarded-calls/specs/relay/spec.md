## ADDED Requirements

### Requirement: a cancelled read stops without interrupting the IDE
The bridge SHALL, on a relay frame `{"id": "<id>", "cancel": "timeout" | "caller_gone"}` for a read (`health`, `refs`,
`fetch`, `grep`), send nothing more for that id and SHALL never interrupt an IDE call; its terminal log line SHALL read
`relay: -> <op> (<id>) cancelled (<reason>)[ after <n> of <m> chunks] <N>ms` (contract:
`packages/volt-cli/docs/relay-protocol.md`, "Cancel").

#### Scenario: a large fetch cancelled while it streams
- **WHEN** the relay cancels a fetch after its first two chunks went out and never acks them
- **THEN** no further chunk of it is sent, another id's chunked answer is delivered, the connection is not dropped for
  the unacked chunks, and the log reads `cancelled (timeout) after 2 of <m> chunks`

#### Scenario: a read cancelled while it runs
- **WHEN** the relay cancels a refs while its walk holds the IDE
- **THEN** the walk completes and no progress or terminal frame is sent for the id

#### Scenario: a read cancelled while queued
- **WHEN** the relay cancels a refs the tunnel has taken but not yet sent to the pipe
- **THEN** the IDE never walks for it

#### Scenario: an unknown or finished id
- **WHEN** a cancel names an id with no request in flight on the connection
- **THEN** the bridge writes a Debug line and nothing else

### Requirement: a write is never cancelled
A cancel for any op that is not a read SHALL be logged as a WARN naming the op and id, and the op SHALL run to its end
and send its terminal frame as without the cancel.

#### Scenario: a cancel for a push
- **WHEN** the relay cancels a push while it holds the IDE
- **THEN** the bridge logs `relay: a cancel for push (<id>) breaks the contract — the relay cancels reads only; the push runs to its end and is answered`, and the push lands and is answered

### Requirement: a malformed cancel is refused by name
A cancel whose `id` is not a string, or whose `cancel` is not `timeout` or `caller_gone`, SHALL be a malformed frame
(a WARN naming which) and SHALL change nothing.

#### Scenario: an unknown reason
- **WHEN** the relay sends `{"id":"r1","cancel":"later"}`
- **THEN** the bridge warns `relay: ignoring a malformed frame — a cancel's `cancel` is not "timeout" or "caller_gone": "later"` and serves r1 as ever
