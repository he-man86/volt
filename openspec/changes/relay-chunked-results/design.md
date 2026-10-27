# Design — the contract

This is the ONE copy of the agreed contract until it's built. Once built, it moves into
`packages/volt-cli/docs/relay-protocol.md`, which describes only what the code does. PLC Assist's design §4 cites this
file, and then that one. Any change goes through a message to PLC Assist first.

## Measured (2026-10-27)

| Measured | Result |
|---|---|
| Throttled proxy, real RelayTunnel + ClientWebSocket, 118 KB fetch result | 2,900 B/s: arrives at 43 s and the 27 s ping arrives after it. 2,000 B/s: the relay closes at 57 s with 1011. The bridge logs `ok 91ms`. |
| 16 × 16 KiB messages sent back to back at 2,000 B/s, a 300 B reply ready at t=5 s | The OS buffered 115–230 KB. The reply waited 60–118 s. Chunks arrived every 8.2 s. |
| GZipStream Optimal, .NET Framework 4.8 x64, fetch-shaped JSON from ST in our customer test corpus | 2 MB: 52 ms, 6.9×. 20 MB: 384 ms, 7.1×. |

So chunking keeps the socket alive, and only flow control bounds how long every OTHER frame waits.

## Frames

**Announcement** (relay → bridge, text), once per connection, right after the relay accepts `hello`:

```json
{ "volt": "relay", "chunks": { "maxBytes": 8192, "ack": true } }
```

A bridge chunks only on a connection that received it. Without it, frames are whole, as today. An older bridge ignores
it: an op-less frame from the relay is ignored and counts as traffic. The bridge logs per connection whether it chunks.

**Chunk** (bridge → relay, BINARY): one JSON header line, `\n`, then raw gzip bytes. The whole message is at most
`maxBytes`.

```
{"id":"r1","seq":0,"count":3,"bytes":121184}\n<gzip slice>
{"id":"r1","seq":1}\n<gzip slice>
{"id":"r1","seq":2}\n<gzip slice>
```

- Only a TERMINAL frame (`result` / `error`) whose UTF-8 is over 8 KiB is chunked. Everything else stays a whole text
  frame: ping, progress, small answers.
- The slices concatenated are gzip(the frame's UTF-8). Inflated, they are byte for byte the frame the bridge would have
  sent whole. `count` and `bytes` are on seq 0 only.
- Integrity: TLS, the gzip trailer (CRC32 + ISIZE) and `bytes`. No second hash.

**Ack** (relay → bridge, text): `{"id":"r1","ack":2}`. Sent at once for each chunk it accepts, before inflating. Also
sent for a chunk of an id that is no longer pending, which the relay then drops.

## Bridge obligations

- **Window, per connection:** unacked chunk bytes ≤ W. W = clamp(acked bytes over the last 5 s ÷ 5 s × 5 s, 16 KiB,
  256 KiB), starting at 16 KiB. While the window is the limit, the measured rate is W/RTT, so W grows about 5 s/RTT
  times per round. At 300 ms RTT it reaches the cap in 2 rounds, and a 20 MB `refs` (~3 MB gzip) takes about 4 s.
  On a 2 KB/s link W stays at 16 KiB.
- Whole frames don't count against W and go out between chunks (one send lock, per message). So any frame waits at
  most about W / uplink plus one chunk: about 12 s at 2 KB/s.
- Chunks of different ids share the window in FIFO order.
- A chunk not acked within 60 s is a stall: a named WARN line, the socket is dropped and redialed.
- Log: the terminal line of a chunked answer gains `<bytes> B as <n> chunks, acked in <s>`.

## Relay obligations (PLC Assist)

- Reassemble per id. A seq > 0 without seq 0, a gap, a duplicate, more than `count` chunks, an inflate error, or an
  ISIZE/length mismatch is `chunk_invalid`: the call is answered `INTERNAL_ERROR`, never dropped silently.
- Guards before work: `count × maxBytes` ≤ 32 MiB, `bytes` ≤ 64 MiB, inflate stops at `bytes`.
- Every chunk counts as traffic for liveness. The socket silence limit is 60 s.

## Relay → bridge: the mirror image

Agreed 2026-10-27, after the owner asked to close the gap rather than keep it as a known limit.

- The bridge's `hello` gains `"chunks": { "maxBytes": 8192, "ack": true }`. A relay MAY then chunk a REQUEST frame
  whose UTF-8 is over 8 KiB, in the same binary form. A bridge without the field (0.1.18029 and older) gets whole frames.
- The bridge acks each chunk at once with `{"id":"r1","ack":seq}`, before inflating. After the last chunk it inflates
  to the exact request frame and serves it as if it had arrived whole.
- **The bridge never runs a request from a partial set of chunks.** A buffer that is not complete when the connection
  ends is discarded. It is never carried to the next connection. So a request whose last chunk the relay never SENT
  cannot have run: the relay answers it as not sent, and a push is then safe to retry. Once the last chunk has been
  sent, a push's outcome is unknown, as it is today.
- A broken chunked request is refused by name: seq > 0 without seq 0, a gap, a duplicate, more than `count` chunks,
  an inflate error, a length mismatch, or `bytes` over 64 MiB (the pipe's frame cap). The bridge logs a WARN and
  answers the id with `BAD_REQUEST`, naming what was broken. Nothing is served.
- The relay runs the same window toward the bridge.
- Relay side, noted so both copies agree: the per-call idle clock starts when the last request chunk is acked (or
  sent, while the ack is in flight). Acks are bridge frames, so they keep the relay's silence clock fresh.

## Connection byte accounting

To learn which limit the RU ISP applies (per message or per connection, up or down), both ends log totals when a
connection closes. The bridge's end line gains
`| sent <B> B (largest <B>), received <B> B (largest <B>)`. Bytes are message payloads, not TCP. The relay logs the
same, plus ASN and colo. Rotating connections is designed only once a RU drop shows a per-connection limit.

## Known limits

- An ISP that cuts a connection after ~16 KB in TOTAL (the likely RU case, 2026-10-14) is not fixed by chunking.
  The byte accounting above measures it, and connection rotation is designed on that evidence. A per-MESSAGE limit
  is covered: no message is over 8 KiB.

## Decided against

- Pings on their own thread, a shorter send bound, WebSocket fragmentation: TCP ordering defeats all three (measured).
- Raising silence limits: it only moves the size where it breaks, and slows detecting a real drop.
- base64 chunks: 33% more upload on exactly the slow links.
- Chunking without acks: measured, every other call still waits for the whole OS buffer.
- An HTTPS side channel: a second credentialed connection from inside the IDE. Kept as the fallback only if this
  design fails its tests.
