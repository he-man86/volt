## ADDED Requirements

### Requirement: the relay protocol number stays 1 across this wire change
In the release that ships `grep`, `build` `applications` and project identity on a push, the bridge SHALL send
`hello.protocol: 1` to the relay, as release 0.1.17884 does, whatever internal wire or schema version Volt records.

#### Scenario: a new bridge dials the PLC Assist relay
- **WHEN** a bridge of this release connects to PLC Assist's relay, which accepts only protocol 1
- **THEN** its hello carries `protocol: 1` and the relay accepts it

#### Scenario: an older bridge after the release
- **WHEN** a bridge of 0.1.17884 connects after the release
- **THEN** the relay still accepts it, and a `grep` sent to it is refused as an unknown op, which PLC Assist reports as
  "download the latest bridge"
