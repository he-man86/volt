## 0. Order

- [ ] 0.1 Apply `refuse-unknown-request-members` and `unreadable-name-carries-kind` first. This change re-pins the schema
      after both have landed, so one bump covers the whole release.

## 1. Tests red

- [ ] 1.1 `RelayTunnelTests`: `hello` carries `protocol: 2` (pinned at 1 today, `:76`), read from `WireProtocol.Version`.
- [ ] 1.2 `RelayTunnelTests`: a 1008 whose reason contains `protocol` logs the neutral line (both remedies, no verdict).
      Update the pins at `:298-310`, `:378`, `:393`, `:416`.
- [ ] 1.3 `DocDataTests`: the generated `volt-bridge.openrpc.json` hashes to the value pinned beside
      `WireProtocol.Version`. On a mismatch the message states the bump rule and says to re-pin. Its `info.version` is
      `WireProtocol.Version`.
- [ ] 1.4 A health wire test on both vendors: `health.protocol` equals `WireProtocol.Version`.
- [ ] 1.5 `Volt.Cli.Tests`: a bridge whose `health` has `protocol` 1, or none, is refused `BRIDGE_PROTOCOL` before any op
      is sent, the message naming both numbers and "restart the IDE". A matching bridge is served.

## 2. Implement

- [ ] 2.1 `Volt.Contracts`: `WireProtocol.Version = 2`. Delete `RelayFrames.Protocol`; `Hello` and `RefusalLine` read the
      new constant.
- [ ] 2.2 `HealthResponse.Protocol` (`int`), filled in `DriverBase.BuildHealthResponse`, the one composer for both vendors.
- [ ] 2.3 `BridgeClient`: one `health` read per process before the first op; refuse on mismatch with `BRIDGE_PROTOCOL`
      (CLI-local, beside `BRIDGE_UNREACHABLE`).
- [ ] 2.4 `RelayTunnel.RefusalLine`: the neutral line.
- [ ] 2.5 `DocDataTests`: `info.version` from `WireProtocol.Version`; the hash pin.

## 3. Docs

- [ ] 3.1 `relay-protocol.md`: `protocol` is `WireProtocol.Version`; the one-sentence bump rule; the neutral refusal line
      (`:172`); every example rewritten with paths (`:54`, `:80`, the transcript at `:320-343`).
- [ ] 3.2 `wire.html`: `protocol` on `health`. `cli.html`: `BRIDGE_PROTOCOL`.
- [ ] 3.3 Owner coordination, not Volt's to do: PLCAssist's relay `PROTOCOL` → 2 in the same release window.
