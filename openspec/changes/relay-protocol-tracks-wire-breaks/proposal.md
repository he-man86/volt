> One wire release, protocol 2, together with `refuse-unknown-request-members` and `unreadable-name-carries-kind`.
> This change carries the shared tasks (the number, the schema pin, the release order) and is applied LAST.

## Why

The path wire (`multi-application-tree`) breaks the wire. Items are keyed by `<folder>/<name>.<kind>`,
`folders`/`knownFolders`/`newFolders` are gone, and `set` takes one `to`. An old peer does not fail on it; it misreads
identity. A new client's path-keyed `knownItems` reach an old bridge as bare names and `knownApplications` is ignored, so
every known item reads as removed or changed. The call succeeds, and the client's pull deletes or misplaces files.
Nothing tells the two peers apart before the first op:

- **The `hello` number never moved.** `RelayFrames.Protocol` is `1` (`packages/volt-cli/src/Volt.Relay/RelayFrames.cs:50`,
  written at `:60`, pinned by `test/Volt.Relay.Tests/RelayTunnelTests.cs:76`). It was introduced in `84bbc054ff`
  (2026-09-24). Since then 29 commits touched `Volt.Contracts/Wire`, at least 5 of them breaking (`94fc929ecd`,
  `c3a49a49ed`, `f7eb383f47`, `a76bb24217`, `7472e6862e`), with 0 bumps. No rule says when it changes, and
  `docs/relay-protocol.md:80` still shows a pre-path request (`"onlyItems": ["FB_Motor.pou"]`).
- **Nothing on the pipe carries a wire number.** `health` has only the display string `bridgeVersion`
  (`src/Volt.Contracts/Wire/HealthResponse.cs:68`). `BridgeClient` checks nothing (`src/Volt.Cli/Sync/BridgeClient.cs:25-26`).
- **Peers really are mismatched.** (a) PLCAssist's relay and client against an engineer's bridge, in both directions
  during a release window: Volt publishes first, so every engineer who updates meets a relay still on 1. (b) Volt's own
  CLI against an old CODESYS bridge. `start_volt_codesys.py:154-208` stages a per-session copy of the bridge DLL, and the
  installer and tray auto-update never stop CODESYS, so after every update made while CODESYS is open the new CLI talks to
  the old in-proc bridge. The TwinCAT worker is relaunched by the installer, and the connector reads only `health`, whose
  shape the path wire did not change.
- **The refusal line blames the bridge.** `RelayTunnel.RefusalLine` (`src/Volt.Relay/RelayTunnel.cs:212-219`) appends
  "download the latest bridge" to every 1008 whose reason contains `protocol`. In case (a) the refused bridge is the
  newer one, which the engineer already has.
- The OpenRPC document's `info.version` is a fixed `"1.0.0"` that names nothing.

## What Changes

- **One number, `WireProtocol.Version = 2`**, in `Volt.Contracts`. `hello.protocol`, `health.protocol` and the OpenRPC
  `info.version` all read it. `RelayFrames.Protocol` is deleted.
- **A shape break is enforced, not described.** A gate pins the hash of the generated `volt-bridge.openrpc.json` beside
  `WireProtocol.Version`. Any wire SHAPE edit turns it red until its author re-pins it, deciding bump or no bump by one
  rule: the number changes when an old peer would read the new wire without refusing it and take a different meaning. A
  change of meaning with the same shape (the schema carries no member descriptions) is not caught; it is covered by the
  rule alone. All 5 measured breaks changed shape.
- **`health.protocol`, read by the CLI.** Every bridge writes it; the schema marks it required. It is stamped by
  `BridgePipeHost` beside `bridgeVersion`, so every host (both vendors and `FakeIde`) carries it. `BridgeClient` reads
  `health` once per process before its first op and refuses a bridge whose `protocol` is not its own. The C# member is
  `int?`: an old bridge's absent member reads as "none", never as 0, and the connector, which must still read an old
  bridge's `health`, keeps reading it. The refusal is a CLI-local code, `BRIDGE_PROTOCOL`, naming both numbers, with the
  remedy that follows the comparison: bridge older or none → "restart the IDE to load the updated bridge"; bridge newer →
  "update Volt". The connector does not refuse: it only reads `health` and issues no op.
- **A neutral refusal line.** `RefusalLine` no longer guesses which side is older: "This bridge speaks relay protocol 2
  (release <volt>); the relay serves another. If this is not the latest bridge, download it; if it is, the service has not
  updated yet and nothing on this machine needs changing." The relay's reason format is unchanged. The substring
  `protocol` in a 1008 reason is the contract, stated in `relay-protocol.md`: it is what PLCAssist's relay already sends.
- `relay-protocol.md`: the rule (one sentence), `protocol` defined as `WireProtocol.Version`, and every example rewritten
  with paths.

## Impact

- `Volt.Contracts` (`WireProtocol`, `HealthResponse.Protocol`), `Volt.Engine.Host/BridgePipeHost.cs` (stamps it),
  `Volt.Relay` (`RelayFrames`, `RelayTunnel.RefusalLine`), `Volt.Cli/Sync/BridgeClient.cs`.
- `test/Volt.Engine.Tests/docs/DocDataTests.cs` (the pin, `info.version`), `docs/volt-bridge.openrpc.json`,
  `docs/wire.html`, `docs/cli.html` (the new code), `docs/relay-protocol.md`.
- Tests: `RelayTunnelTests`, `DocDataTests`, `Volt.Cli.Tests` (protocol refusal), a health wire test on both vendors.
- For the owner to coordinate, not Volt's to do: PLCAssist's relay moves its `PROTOCOL` to 2 in the same release window.
  Its reason format stays as it is.
