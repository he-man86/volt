# Design

The contract is built and lives in `packages/volt-cli/docs/relay-protocol.md` (Chunks, Liveness, the end-line byte
counts, the bridge log, Known limits), which describes only what the code does; PLC Assist's design §4 cites that file.
Any change to it goes through a message to PLC Assist first. This file keeps only what the doc does not: the
measurements that chose the design, and what was decided against.

## Measured (2026-10-27)

| Measured | Result |
|---|---|
| Throttled proxy, real RelayTunnel + ClientWebSocket, 118 KB fetch result | 2,900 B/s: arrives at 43 s and the 27 s ping arrives after it. 2,000 B/s: the relay closes at 57 s with 1011. The bridge logs `ok 91ms`. |
| 16 × 16 KiB messages sent back to back at 2,000 B/s, a 300 B reply ready at t=5 s | The OS buffered 115–230 KB. The reply waited 60–118 s. Chunks arrived every 8.2 s. |
| GZipStream Optimal, .NET Framework 4.8 x64, fetch-shaped JSON from ST in our customer test corpus | 2 MB: 52 ms, 6.9×. 20 MB: 384 ms, 7.1×. |

So chunking keeps the socket alive, and only flow control bounds how long every OTHER frame waits.

## Decided against

- Pings on their own thread, a shorter send bound, WebSocket fragmentation: TCP ordering defeats all three (measured).
- Raising silence limits: it only moves the size where it breaks, and slows detecting a real drop.
- base64 chunks: 33% more upload on exactly the slow links.
- Chunking without acks: measured, every other call still waits for the whole OS buffer.
- Keeping `GzipMember` (a 331-line port of zlib's puff): reinvents the runtime's inflater. Built instead: the
  bridge reads the gzip header, the runtime's `DeflateStream` inflates the bytes between it and the last 8, and the
  bridge checks those 8 as the trailer (CRC32 + ISIZE). Not `GZipStream`: measured on net48 and net10, it accepts a
  missing trailer, refuses a bad one itself with a runtime- and OS-language message, and inflates a second member on
  net10 only. Handed no framing, the runtime's inflater answers the same on both vendor hosts.
- Relying on the 64 MiB `bytes` cap alone for the request side: `count` arrives first, so the relay's 32 MiB
  `count` guard refuses before anything is buffered; the bridge mirrors it so both copies refuse the same set.
- An HTTPS side channel: a second credentialed connection from inside the IDE. Kept as the fallback only if this
  design fails its tests.
