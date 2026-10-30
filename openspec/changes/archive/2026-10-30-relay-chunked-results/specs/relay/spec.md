## ADDED Requirements

### Requirement: a large result never blocks the relay socket
A terminal frame over 8 KiB SHALL travel as acknowledged binary chunks of at most the relay's announced `maxBytes`,
sent within a per-connection window, so pings and other ids' frames interleave with it (contract:
`packages/volt-cli/docs/relay-protocol.md`).

#### Scenario: a 120 KB fetch result on a 2 KB/s uplink
- **WHEN** the bridge answers a 120 KB fetch through a relay that announced chunks
- **THEN** the result arrives as chunks, every ping is answered within the relay's silence limit, and the socket stays up
