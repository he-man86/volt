## ADDED Requirements

### Requirement: The bridge pushes project-change events over an event stream

The bridge SHALL push a `change` event to subscribed clients when the loaded project changes, so a long-lived
client reacts without polling. It SHALL expose an event stream — `GET /events` (Server-Sent Events) — that a
client opens once and on which the bridge emits a `change` event carrying the new change token (`structureVersion`
+ a content token) whenever the project changes, plus periodic keep-alives; the stream SHALL be served without
holding the marshalled IDE thread, and disconnected subscribers SHALL be cleaned up. The event wire SHALL be
identical for every vendor — HOW a change is detected (a native IDE event where the IDE exposes one, an internal
poll where it does not) is an implementation detail behind a single internal change source and SHALL NOT leak to
the wire. Detection SHALL be centralized in the bridge (one source, fanned out to all subscribers), never a poll
performed by each client. The surface is additive: a client that never subscribes is unaffected, and `/refs` /
`/fetch` remain the authoritative source of WHAT changed. A long-poll `GET /wait-change?since=<token>` MAY be
offered with equivalent semantics for clients that cannot consume SSE.

#### Scenario: A subscriber is pushed a change after an IDE edit
- **WHEN** a client is subscribed to `/events` and an engineer edits the project in the IDE
- **THEN** the bridge pushes a `change` event carrying the new token, without the client polling

#### Scenario: No event when nothing changed
- **WHEN** the project is unchanged
- **THEN** the bridge emits only keep-alives (no `change`), so a client performs no redundant refresh

#### Scenario: Detection differences do not leak to the wire
- **WHEN** the same edit is made against the CODESYS bridge (internal poll) and the TwinCAT bridge (native DTE event)
- **THEN** both push an identical `change` event — the wire is the same regardless of how the change was detected

#### Scenario: Detection is centralized, not per-client
- **WHEN** multiple clients are subscribed to `/events`
- **THEN** the bridge detects a change once and fans it out to all subscribers; no client polls the IDE
