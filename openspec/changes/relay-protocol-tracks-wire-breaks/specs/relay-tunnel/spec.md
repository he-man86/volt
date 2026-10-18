## ADDED Requirements

### Requirement: one protocol number, moved on every wire break
Volt SHALL hold one wire protocol number, `WireProtocol.Version`. The bridge's `hello.protocol` and `health.protocol`, and
the OpenRPC document's `info.version`, SHALL all carry it. A gate SHALL pin the hash of the generated OpenRPC document
beside the number, so any change of the wire's shape fails the gate until it is re-pinned. The number SHALL change when an old peer
would read the new wire without refusing it and take a different meaning.

#### Scenario: the path-wire release
- **WHEN** a bridge keys items by `<folder>/<name>.<kind>`
- **THEN** its `hello` carries `"protocol": 1`, and its `health` carries `"protocol": 1` (owner decision: the number stays 1 for this release; this schema is pinned as protocol 1)

#### Scenario: a wire edit without a re-pin
- **WHEN** a contract type changes and the generated OpenRPC document's hash no longer matches the pin
- **THEN** the gate fails, stating the bump rule

### Requirement: the CLI refuses a bridge of another protocol
Before its first op, the CLI SHALL read `health` and refuse a bridge whose `protocol` differs from its own, or is absent,
with `BRIDGE_PROTOCOL` naming both numbers (an absent one as "none"). When the bridge's number is lower or absent the
remedy SHALL be to restart the IDE; when it is higher, to update Volt. No op SHALL be sent to it.

#### Scenario: a stale in-proc CODESYS bridge
- **WHEN** the CLI is updated while CODESYS keeps the previous bridge loaded, and that bridge's `health` has no `protocol`
- **THEN** `volt pull` fails `BRIDGE_PROTOCOL` naming protocol "none", telling the engineer to restart the IDE, before
  any `fetch`, and no file changes

#### Scenario: a bridge newer than the CLI
- **WHEN** a bridge's `health` carries a protocol above the CLI's
- **THEN** `volt pull` fails `BRIDGE_PROTOCOL` telling the engineer to update Volt, and no op is sent

### Requirement: a protocol refusal does not guess which side is older
When the relay closes 1008 with a reason containing `protocol`, the bridge log's line SHALL state the bridge's protocol
and release, and SHALL give both remedies: download the latest bridge if this one is not the latest, otherwise wait for
the service to update.

#### Scenario: a new bridge meets an un-redeployed relay
- **WHEN** a protocol-1 bridge is closed with 1008 `unsupported protocol 1`
- **THEN** the line does not tell the engineer only to download the bridge; it says that if the bridge is the latest, the
  service has not updated yet
