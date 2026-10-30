> Owner, 2026-10-27: chunking is the preferred direction ("think about it carefully"; stability, no quick fix). Design
> is joint with PLC Assist's relay. Nothing is built until both owners decide.

## Why

On a slow uplink one large frame blocks the relay socket. A fetch result of about 120 KB takes 42 s at 2.9 KB/s, and
nothing behind it in the TCP stream (pings, progress, other ids' answers) can overtake it. PLC Assist's relay sees no
complete message for 55 s and closes a healthy bridge (production, 2026-10-27, CN uplink). The repro used a throttled
TCP proxy, the real RelayTunnel and the real ClientWebSocket:
- at 2,900 B/s the result arrives at 43 s, and the ping sent at 27 s arrives after it;
- at 2,000 B/s the relay closes at 57 s with 1011;
- the bridge logs `ok 91ms` because the OS buffer took the whole frame at once.

A second probe sent 16 KiB chunks back to back at 2,000 B/s. The OS buffered 115–230 KB, and a 300 B reply waited
60–118 s behind it. Chunking alone keeps the SOCKET alive (a chunk arrives every 8 s), but not any other call in flight.

## What Changes

The contract text goes into `packages/volt-cli/docs/relay-protocol.md` once it's agreed. That file is the only copy;
PLC Assist's design cites it.
- A large terminal frame travels compressed, as bounded chunk messages. The relay reassembles it to the exact frame.
- The relay acks each chunk. The bridge keeps a bounded number of chunk bytes unacked per connection, so every other
  frame waits about W / uplink at most. The ack is also the bridge's first real "delivered" signal, for the log and
  for naming stalls.
- The relay's 55 s silence limit becomes 60 s, as the spec states (relay side).
- Protocol stays 1. An older peer keeps working: chunking is announced by the relay per connection.

Open points (PLC Assist's design §8, our review of 2026-10-27): base64 or binary chunks, chunk size 8 or 16 KiB, the
window formula, sha256 or the gzip trailer, relay→bridge chunking (out of scope, a named limit), and the RU ISP case
(likely a per-connection cut, which chunking does not fix).

## Impact

`Volt.Relay` (RelayTunnel send path, IRelaySocket binary send if chosen, log lines), `docs/relay-protocol.md`,
`Volt.Relay.Tests` (a throttled-proxy test at real socket level, with scaled-down limits so it runs in CI).
Counterpart: PLCAssist `openspec/changes/relay-chunked-results/design.md`.
