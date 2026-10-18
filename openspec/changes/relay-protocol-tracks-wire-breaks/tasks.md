## 0. Order

- [x] 0.1 Apply `refuse-unknown-request-members` and `unreadable-name-carries-kind` first. This change re-pins the schema
      after both have landed, so one bump covers the whole release.

## 1. Tests red

- [x] 1.1 `RelayTunnelTests`: `hello` carries `protocol: 1` (owner decision 2026-10-18; was planned as 2), read from `WireProtocol.Version`.
- [x] 1.2 `RelayTunnelTests`: a 1008 whose reason contains `protocol` logs the neutral line (both remedies, no verdict).
      Update the pins at `:298-310`, `:378`, `:393`, `:416`.
- [x] 1.3 `DocDataTests`: the generated `volt-bridge.openrpc.json` hashes to the value pinned beside
      `WireProtocol.Version`. On a mismatch the message states the bump rule and says to re-pin. Its `info.version` is
      `WireProtocol.Version`.
- [x] 1.4 A health wire test on both vendors: `health.protocol` equals `WireProtocol.Version`.
- [x] 1.5 `Volt.Cli.Tests`: a bridge answering `protocol` 1, or none, is refused `BRIDGE_PROTOCOL` before any op, naming
      both numbers ("none" for absent) and "restart the IDE"; one answering 3 is refused with "update Volt". A matching
      bridge is served. The host stamp is overridable for the test (a `BridgePipeHost` ctor knob, default
      `WireProtocol.Version`), so a fake bridge can answer 1, 3 or no member.
- [x] 1.6 The connector reads a `health` with no `protocol` without error.

## 2. Implement

- [x] 2.1 `Volt.Contracts`: `WireProtocol.Version = 1` (owner decision 2026-10-18; was planned as 2). Delete `RelayFrames.Protocol`; `Hello` and `RefusalLine` read the
      new constant.
- [x] 2.2 `HealthResponse.Protocol` (`int?`, required in the schema), stamped in `BridgePipeHost` beside
      `h.BridgeVersion = Release`, so both vendors and `FakeIde` carry it.
- [x] 2.3 `BridgeClient`: one `health` read per process before the first op; refuse on mismatch with `BRIDGE_PROTOCOL`
      (CLI-local, beside `BRIDGE_UNREACHABLE`), remedy by comparison.
- [x] 2.4 `RelayTunnel.RefusalLine`: the neutral line.
- [x] 2.5 `DocDataTests`: `info.version` from `WireProtocol.Version`; the hash pin; `protocol` required on `health`.

## 3. Docs

- [x] 3.1 `relay-protocol.md`: `protocol` is `WireProtocol.Version`; the one-sentence bump rule (the pin catches shape;
      meaning is the author's call by the rule); a 1008 reason containing `protocol` is a protocol refusal (the
      contract); the neutral refusal line (`:172`); every example rewritten with paths (`:54`, `:80`, `:320-343`).
- [x] 3.2 `wire.html`: `protocol` on `health`. `cli.html`: `BRIDGE_PROTOCOL`.
- [ ] 3.3 Owner coordination, not Volt's to do: PLCAssist's relay `PROTOCOL` → 2 in the same release window.
      (Open, for the owner.)
