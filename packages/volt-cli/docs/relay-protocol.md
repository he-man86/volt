# The relay protocol

**Status:** implemented (bridge half: `packages/volt-cli/src/Volt.Relay`). Both bridges start it through
`PipeHostTunnel.StartIfConfigured`: the CODESYS in-proc host (`Volt.Ide.Codesys/PipeHost.cs`) and the TwinCAT
worker (`Volt.Ide.Twincat/Program.cs`). This page describes what that code does today; where it and the page
disagree, the code is right and this page is the bug.

This is the whole specification a relay author reads. It defines how a Volt bridge dials OUT to a relay and
serves pipe ops that arrive over it, so a client whose code runs somewhere else (a datacenter, another
machine) can drive an IDE sitting on an engineer's laptop behind NAT.

Volt publishes the protocol and implements the bridge half (`Volt.Relay`). **Volt runs no relay, issues no
tokens and authenticates no one.** The relay, its auth, its users and its own client-facing API belong to
whoever runs it.

## Roles

```
your client ──(your own API)──▶ your relay ◀──WSS, dialed OUT by the bridge── Volt.Relay
                                                                                 │ PipeClient, one connection per request
                                                                                 ▼
                                                        volt.bridge.<vendor>.<pid>   (the ordinary named-pipe host)
```

The bridge is the WebSocket **client**. It never listens. A relay that cannot be dialed is a relay with no
bridges; there is no inbound path to an engineer's machine and this protocol does not create one.

`Volt.Relay` forwards each tunneled request to the local bridge pipe as an ordinary `PipeClient` call (the same
call the CLI makes) and streams the frames back. It adds no logic of its own: every guard (`OpGuard`, the
disconnect gate, `ifVersion`) lives in the pipe host and applies unchanged, because the tunnel is just another
pipe client. **There is one entry point to the engine and every guard is on it.** The assembly references
`Volt.Contracts` and `Volt.Wire` only, so it cannot call the engine any other way.

## Connection

The bridge opens ONE WebSocket to the URL it was configured with, sending:

```
Authorization: Bearer <token>
```

The token travels as a header, never in the URL. It is opaque bytes to Volt; the relay decides what it means,
and is the only party that can.

A relay MAY reject the upgrade (401/403). A relay MUST NOT require any other header: the bridge sends none,
and a `ClientWebSocket` running inside an IDE's scripting host is not a browser. The socket's own WebSocket
keep-alive interval is 25 s, matching the protocol's heartbeat below.

### Handshake

The bridge's first frame, before any response frame:

```json
{ "hello": { "protocol": 1, "volt": "0.0.1.842", "vendor": "codesys", "pipe": "volt.bridge.codesys.1234",
             "chunks": { "maxBytes": 8192, "ack": true } } }
```

| field | meaning |
| --- | --- |
| `protocol` | The wire protocol, `WireProtocol.Version`: `1`. The same number `health.protocol` and the OpenRPC document's `info.version` carry. It changes when an old peer would read the new wire without refusing it and take a different meaning; `DocDataTests` pins the generated schema's hash beside it, so a change of shape fails until its author re-pins and decides, and a change of meaning is the author's call by the same rule. |
| `volt` | The bridge's release, for the relay's logs and support — the same value `health.bridgeVersion` carries (`BridgeRelease`): the stamped version of a release build (`0.0.1.842`), or `(dev) <commit>` for an unstamped one (`(dev)` alone only when its file states no commit). Empty only when the bridge cannot read its own file. It was the assembly version, `1.0.0.0` on every unstamped build. |
| `vendor` | `codesys` or `twincat`. |
| `pipe` | The local pipe this tunnel serves. Diagnostic: it identifies WHICH IDE on a machine with several. |
| `chunks` | What the bridge takes as a chunked request: messages of at most `maxBytes` bytes, each acked (see [Chunks](#chunks)). |

There is **no negotiation**, and no acknowledgement of `hello`. A relay that will not serve this bridge (for
example because it does not speak `protocol`) closes the socket with **1008 and a reason**; see
[Closing a bridge](#closing-a-bridge). A 1008 whose reason contains `protocol` is a protocol refusal: that substring
is the contract.

`hello` is sent once per connection, including after every reconnect. It is **not** re-sent when the served
project changes; ask `health` for that. One source of truth.

The relay's client (PLC Assist's, which runs in Docker and reaches the pipe only through the relay) sends `health`
before any other op and refuses a bridge whose answer has no `languages` or no `kinds`: that bridge is of an older wire
and would serve a request of this one leniently. An empty list is a fact and passes. See `wire.html#catalog`.

## Frames

A frame is a text message holding one JSON object. A frame may be large (a `fetch` or `refs` result on a big project
is megabytes); a large one may instead cross as binary chunks (see [Chunks](#chunks)). A binary message is a chunk and
nothing else. Either kind may arrive in as many WebSocket fragments as it needs; the bridge reassembles to the end of
the message before parsing.

**Request** (relay → bridge):

```json
{ "id": "<opaque>", "op": "fetch", "protocol": 1, "body": { "onlyItems": ["Device/Plc Logic/Application/FB_Motor.pou"] } }
```

`protocol` is the remote client's wire protocol, forwarded to the pipe as stated: a request without it, or of another
number, is answered `PROTOCOL_MISMATCH` by the bridge itself, before its body is read (`wire.html`).

`id` is the relay's own, a JSON string; the bridge treats it as opaque and echoes it. Uniqueness is the relay's
problem: a relay that reuses an id while the first is in flight gets two answers it cannot tell apart.

A FRAME field the bridge does not know is ignored, and the op is served exactly as without it. A BODY member the
op does not have is refused `BAD_REQUEST`, naming the op and the member: request bodies are read strictly. The
ignored frame fields include a caller's budget (`budgetMs`): the bridge has no request deadline and never refuses an op for having waited. What
keeps a write from starting late, for nobody, is that a `push` or `build` never waits behind another one — it is
refused `IDE_BUSY` at once (see Concurrency). The only things it can queue behind are a read or the health probe's
refresh, which take seconds.

**Response** (bridge → relay): zero or more progress frames, then **exactly one** terminal frame.

```json
{ "id": "…", "progress": { "operation": "fetch", "done": 40, "total": 138 } }
{ "id": "…", "result":   { "projectVersion": "…", "items": { … } } }
{ "id": "…", "error":    { "code": "PLC_DISCONNECTED", "message": "…" } }
```

`progress` and `result` are the pipe's own frames, forwarded verbatim with the id attached: the same shapes
`wire.html` documents for the local pipe. A relay does not need to understand them to route them; a client
does, and reads them there.

A terminal frame ends the request. A relay MUST tolerate zero progress frames (most ops send none) and MUST
NOT assume any relationship between `done`/`total` and time. Progress is best-effort: a progress frame that
fails to send is dropped, the request is not.

`refs` and `fetch` send frames from the start of their walk: one per application walked (`phase: "walking"`,
`done` of `total` applications; a TwinCAT PLC project is an application), then the item frames (`phase:
"reading"` first, then one every 25 items). On a large TwinCAT solution the walk alone can take longer than a
minute, so a relay that counts progress sees the bridge working before any item is read (`wire.html`).

**Anything else** from the relay (a frame with no `op` that is neither the chunk announcement nor an ack: a pong, a
keepalive, a field from a newer relay) is ignored, but counts as traffic for the watchdog.

## Chunks

A large frame crosses as binary messages of a few KiB each, so a slow link keeps carrying traffic and no message is
large. Both directions use one form: the receiver states the largest message it takes, and acks every chunk.

### The form

A chunk is ONE binary message: a JSON header line, `\n`, then a slice of gzip(the frame's UTF-8).

```
{"id":"r1","seq":0,"count":3,"bytes":121184}\n<gzip slice>
{"id":"r1","seq":1}\n<gzip slice>
{"id":"r1","seq":2}\n<gzip slice>
```

- `count` (the chunks in the set) and `bytes` (the frame's UTF-8 length) are on seq 0 only.
- The slices in seq order are ONE gzip member: header, deflate data, the 8-byte trailer (CRC32 of the frame, ISIZE).
  Inflated, it is byte for byte the frame that would have been sent whole.
- Integrity is TLS, the gzip trailer and `bytes`. There is no second hash.

**Ack**, a text frame from the receiver: `{"id":"r1","ack":2}` (chunk 2 of `r1` arrived). It is sent at once, before
inflating, for every chunk whose header names an id and a seq: accepted, refused, or of an id no longer pending (its
set dropped). An ack means "received", not
"valid": an unacked chunk would hold the sender's window until the sender drops the socket.

### Bridge → relay: a large answer

The relay announces, once per connection, after it accepts `hello`:

```json
{ "volt": "relay", "chunks": { "maxBytes": 8192, "ack": true } }
```

- A connection chunks once it has received the announcement, whatever frames came before it. Without it every frame
  is whole. A second announcement is ignored (WARN) and the first stands.
- An announcement without a `chunks` object, a positive integer `chunks.maxBytes` or `chunks.ack: true` is a malformed
  frame (WARN, naming which) and changes nothing: a connection that has no valid announcement stays whole-frame, one
  that has keeps chunking.
- Chunked: a TERMINAL frame (`result` / `error`) whose UTF-8 is over **8192 B**. Ping, progress, acks and small
  answers stay whole text frames.
- The connection's chunk size is min(`maxBytes`, 16384) B; every chunk but the last is exactly that. Gzip level:
  Optimal.
- Whether an answer may be chunked is fixed when its request arrives. A request whose `id` is too long for a seq 0
  header in one chunk of that size is answered `BAD_REQUEST` then, before its op runs: `the request id (<n> characters)
  cannot fit a chunk header in the <m> B chunks this connection sends, so a large answer could not be delivered; it
  was not run`.

**Window.** Per connection, the chunk bytes sent and not yet acked are at most W. W = the bytes acked in the last 5 s,
clamped to **16–256 KiB**, starting at 16 KiB. From a cold start W at most doubles per round trip (16, 16, 32, 64, 128,
256 KiB); on a 2 KB/s link it stays at 16 KiB.

- An answer queues all its chunks, in order, when it is ready; chunks of different ids go out FIFO.
- Whole text frames do not count against W and go out between two chunks (one send at a time), so any frame waits at
  most about W / uplink plus one chunk: ~12 s at 2 KB/s.

**Delivery.** A chunked answer is delivered at its LAST ack. An ack for a chunk that is not awaiting one is a WARN.

- On each heartbeat tick (25 s), a chunk unacked for more than **60 s** drops the socket, 60–85 s after it went.
- A chunk whose send fails drops the socket: the relay learns from the socket ending that the answer will not
  complete, and discards what it holds.
- Every chunk send is under the same 60 s send bound as a frame (see [Liveness](#liveness)).

The relay, receiving: it reassembles per id and answers a broken set (a seq > 0 without seq 0, a gap, a duplicate,
more than `count` chunks, an inflate error, a CRC32, ISIZE or length mismatch) to its caller as `INTERNAL_ERROR`, never
silently. It checks the gzip trailer itself: the set's last 8 bytes are CRC32 of what inflated and ISIZE = `bytes`.
A runtime's gzip reader is not trusted with the trailer: Node's `DecompressionStream` accepts a second member, and
.NET's `GZipStream` accepts a missing trailer. The bridge checks it the same way (the refusals below). Before any work it refuses `count` × `maxBytes` over 32 MiB and `bytes` over 64 MiB, and it inflates no
further than `bytes`. A chunk is traffic for its 60 s silence limit.

### Relay → bridge: a large request

`hello`'s `chunks` states what the bridge takes: messages of at most **8192 B**, each acked. The relay MAY then chunk a
request frame whose UTF-8 is over 8 KiB, and runs the same window toward the bridge. The bridge inflates the set at its
last chunk and serves the request exactly as if it had arrived whole. A bridge whose `hello` has no `chunks` gets
whole request frames. The relay's per-call idle clock starts when the last request chunk is acked, or is sent while
that ack is in flight.

**A request is never run from a partial set.** A set not complete when its connection ends is discarded, never carried
to the next connection. So a request whose last chunk the relay never SENT cannot have run, and a push is safe to
retry. Once the last chunk has been sent, a push's outcome is unknown, as with a whole frame.

A broken set is answered with ONE error frame, `BAD_REQUEST`, message `chunked request refused: <reason>; it was not
run`. The reasons:

| `<reason>` | when |
| --- | --- |
| ``a chunk of <id> has no chunk number (`seq`, a non-negative integer)`` | no usable `seq`; this chunk is not acked |
| `chunk <k> of <id> is <n> B, over the 8192 B this bridge announced` | judged by the message's length on the wire |
| `chunk <k> of <id> arrived twice` | a duplicate |
| ``chunk 0 of <id> has no positive integer `<field>` `` | `count` or `bytes` missing or below 1 |
| `chunk 0 of <id> states <n> chunks: <n> x 8192 B is over the 33554432 B (32 MiB) a chunked request may take` | `count` over 4096 |
| `chunk 0 of <id> states <n> B, over the 67108864 B frame cap` | `bytes` over 64 MiB |
| `chunk <k> of <id> arrived without chunk 0` | |
| `chunk <k> of <id> is past the <n> chunks chunk 0 states` | more than `count` |
| `chunk <k> of <id> arrived after chunk <j>: chunk <j+1> is missing` | a gap |
| `chunk <k> of <id> brings the set to <n> B of gzip, over the <m> B this bridge holds for a request of <B> B (2 x bytes + 1 KiB)` | one set |
| `chunk <k> of <id> brings this connection's unfinished chunked requests to <n> B of gzip, over the 67108864 B (one frame cap) the bridge holds at once` | all unfinished sets on the connection |
| `the chunks of <id> do not inflate (<what>)` | not a gzip header, a header defect, or `the deflate data is not valid` |
| `the chunks of <id> are <n> B, too short for their <h> B gzip header and the 8-byte trailer (CRC32 and ISIZE)` | |
| `the chunks of <id> inflate past the <B> B chunk 0 states` | |
| `the chunks of <id> fail the gzip CRC32 check` | the last 8 bytes are not the trailer of what inflated |
| `the chunks of <id> end with ISIZE <n> in the gzip trailer, not the <B> B they inflate to` | |
| `the chunks of <id> inflate to <n> B, not the <B> B chunk 0 states` | |
| `the chunks of <id> inflate to bytes that are not UTF-8` | |
| `the reassembled frame of <id> is not a request` | a frame of another kind (an ack, a pong) |
| `the reassembled frame of <id> is not a request (<why>)` | a frame the bridge cannot read: not JSON, not an object, no string `id`, … |
| `the reassembled request of <id> names the id "<other>"` | |

The rest of a refused set is acked and dropped. A chunk past the end of a set already reassembled is acked, named in a
WARN and never answered twice. A chunk 0 under an id whose set is finished (reassembled or refused) starts a new
request; under an id whose set is unfinished it is `arrived twice`, and that set is refused. A connection
remembers its last 256 finished ids; a later chunk of an id further back is `arrived without chunk 0`.

A binary message with no header line, a header that is not JSON, or no string `id` has no one to answer: a WARN and
nothing else.

## The op allowlist

```
health   refs   fetch   push   build   grep
```

Anything else, including `connect` and `disconnect`, is answered `BAD_REQUEST` **without touching the pipe**.

`connect`/`disconnect` stay local on purpose: a remote party does not get to rebind which project an
engineer's IDE serves. `init` is not an op; it is `fetch` with `init: true`.

The allowlist is enforced by the bridge (`RelayFrames.Allowed`, built from the `Ops` constants), not by the
relay. A relay is free to expose fewer ops to its own clients; it cannot expose more.

## Concurrency

One pipe connection per request id. Ops run concurrently to the extent the pipe allows, which is the property
that matters in practice: **`health` answers while a `push` or `build` holds the IDE thread.**

**A `push` or `build` while another push or build runs is refused, not queued:** the error frame `IDE_BUSY`
("the IDE is running a build or push — nothing was applied"), answered at once, before the IDE is touched. One
gate in the bridge, tried and never waited on, so both vendors answer alike and a retried build is refused
instead of stacked. Wait for the running op to answer, then try once. (Before this, CODESYS ran the second op
nested inside the running build — its build pumps the IDE's thread — and TwinCAT queued it.)

The reads (`refs`, `fetch`) are not gated: they change nothing. On TwinCAT they queue behind a running build;
on CODESYS one may answer while a build runs. That is a difference in timing, never in the bytes answered.

**A `refs` while an identical `refs` runs joins it** (same body): it receives the running one's progress frames
from then on and the same terminal frame, so a retry waits for the walk already under way instead of queueing
another. Nothing is kept once it answers: the next `refs` walks again.

The heartbeat is the bridge's own: every request's pipe call holds a thread of its own, so neither a long op on
the IDE's thread nor the requests waiting behind it delay a ping.

A relay may have many requests in flight on one socket. Frames for different ids interleave freely; a relay
demultiplexes on `id` and nothing else. Frame ORDER is guaranteed only within one id.

## Liveness

- The bridge sends the constant text frame `{"volt":"ping"}` every **25 s**. It never varies, so a hosted relay
  can answer it at its edge (an exact-match auto-response) without waking whatever owns the connection.
- A relay SHOULD answer with the constant `{"volt":"pong"}`. The bridge correlates nothing: the pong exists
  only to be traffic. Any message from the relay counts, a chunk or an ack included; the bridge's acks are traffic
  for the relay the same way.
- On each 25 s tick, if the bridge has had **no frame from the relay for more than 60 s**, it drops the socket
  (no close handshake) and reconnects. Silence is therefore noticed 60–85 s after the last frame.
- Every send is bounded by the same **60 s**. A frame that has not gone out by then (a network that stops carrying
  large messages without resetting the flow) is named in a WARN line — `a <N>-byte frame did not go out within 60s —
  the connection to the relay stalls; dropping it` — and the socket is dropped and redialed. Without the bound the
  stalled send held the one send slot for ever and the heartbeat (and its watchdog) waited behind it, silently.

A request in flight when the socket drops **is abandoned**. The bridge does not re-run it and does not answer
it on the new connection. The relay fails it to its own caller. This is safe to retry by design: `ifVersion`
and `expectedProjectVersion` make a repeated push either apply once or reject as stale, never apply twice.

## Closing a bridge

Reconnecting is the bridge's job; a relay does nothing to encourage it. What the relay CAN choose is how it
ends a connection, and the bridge reads that choice.

Every end is ONE log line, whatever ended it:
`relay: connection on <pipe> ended after <N>s — <cause> | in flight: <ids or none> | sent <B> B (largest <B>), received <B> B (largest <B>) | next dial in <N>s`
(`ended before it connected` when the dial itself failed). The pipe name embeds the bridge's pid, which is what
tells two processes apart in one vendor's log file. The ids are the requests still open when the connection went;
each also gets its own `abandoned` terminal line (see "The bridge log" below). `sent` and `received` are the message
payload bytes the connection carried each way — a text frame in UTF-8, a binary message at its length on the wire, a
close not counted — and the largest single message; a dial that never connected carried `0 B (largest 0)`.
`received` counts each read as it arrives, so a message the connection lost partway counts the bytes that came.
`sent` counts a message once the bridge's socket took it whole: a send that failed or stalled counts nothing, and a
counted message was handed to the operating system, not proven delivered.

| How the connection ended | Level and `<cause>` | Next dial |
| --- | --- | --- |
| Close **1008** with a reason | ERROR: `the relay refused this bridge (1008 "<reason>").` When the reason contains `protocol`, it adds: `This bridge speaks relay protocol 1 (release <volt>); the relay serves another. If this is not the latest bridge, download it; if it is, the service has not updated yet and nothing on this machine needs changing.` It does not guess which side is older: an un-redeployed relay refuses a newer bridge with the words an updated one uses for an older bridge. It ends `Trying again in 60 minutes.` | after **1 hour** (+ up to 1 s jitter) |
| Close with any other status (1000, 1001, 1011, …) | INFO: `the relay closed the connection: <status> "<description>"` | ordinary backoff |
| No close at all (1006: the flow died, the relay restarted) | WARN: `dropped without a close (<exception>): <message>` | ordinary backoff |
| The silence watchdog dropped it | WARN: `the watchdog dropped it (no frame for 60s)` (the watchdog also logs its own WARN line the moment it fires) | ordinary backoff |
| A send stalled | WARN: `a send stalled (a <N>-byte frame did not go out within 60s)` (after its own WARN line) | ordinary backoff |
| A chunk was not acked | WARN: `a chunk was not acked (chunk <k> of <id> within 60s)` (after its own WARN line) | ordinary backoff |
| A chunk could not be sent | WARN: `a chunk could not be sent (chunk <k> of <id>: <exception>)` (after its own WARN line) | ordinary backoff |
| The heartbeat task died | WARN: `the heartbeat died (<exception>): <message>` (after its own ERROR line with the whole exception) | ordinary backoff |
| The chunk sender died | WARN: `the chunk sender died (<exception>): <message>` (after its own ERROR line with the whole exception) | ordinary backoff |
| Upgrade refused (HTTP 401/403), or any failed dial | WARN: `could not connect (<exception>): <message>`, with `ended before it connected`. On .NET (the TwinCAT worker) the message names the HTTP status; the CODESYS host's .NET Framework socket may report only that it could not connect. | ordinary backoff |

**Ordinary backoff** is 1 s, doubling after each end, capped at **30 s**, with 0–1 s of jitter added to every
wait so bridges do not redial a restarted relay in lockstep. A connection on which the relay sent **at least
one frame** was served, and resets the backoff to 1 s whatever ended it. A connection closed before the relay
said anything does not.

**1008 means "retrying will not help".** It is the only status that slows the bridge down, so a relay SHOULD
use it only for a refusal that a redial cannot change (a protocol it does not speak) and SHOULD use 1001/1011
for anything transient. Even so, a 1008 is **never final**: the bridge dials again an hour later, for the life
of the process. The CODESYS bridge runs in-proc in `CODESYS.exe`, so "restart the bridge" would mean
restarting the engineer's IDE, and one mistaken 1008 from a relay deploy would otherwise strand every bridge
until each user did that. A 1008 followed by an accepted connection is simply over: the backoff is back at 1 s.

A refused tunnel never stops the bridge serving its local pipe. The tunnel is an addition to a bridge that
already works on the machine it runs on.

### The bridge's own closes

The table above is closes the RELAY sends. The bridge sends one: **a deliberate stop closes with 1001 and the
reason `bridge stopping`**, then drops the socket. That covers the CODESYS stop script, the CODESYS IDE exiting
(its `ProcessExit`, measured on SP21), Ctrl+C on the TwinCAT worker, and closing the worker's console window. One
reason for every stop: a relay needs "stopped on purpose" against "dropped", not which button stopped it. Never
1008 — a redial after a restart is welcome. The bridge waits **at most about 1 s** for the Close frame to go out
and does not wait for the relay's answer, so a stop never holds up an IDE that is closing; the bridge logs
`relay: stopping — sent close 1001 bridge stopping` (or that the close did not go out within 1 s).

Still **1006**, with no Close: the silence watchdog, a stalled send, an unacked or unsendable chunk, a dead heartbeat
or chunk sender (a handshake with a peer that stopped answering is a wait whose answer is known), a TwinCAT worker the
connector stops (it kills the process tree, and no code runs in a killed process), and a crash.

**A refused credential is a 401, not a 1008.** A bad bearer token fails the HTTP upgrade inside the connect
call and never reaches a close frame, so it takes the ordinary backoff (a redial every 30 s). A relay that
wanted a bad token treated as final would have to accept the upgrade and close with 1008, which the bridge
would then log as a refusal and retry hourly.

### One relay, read from its code

The rules above were written against PLC Assist's relay, read from its source (`infra/relay-worker/src/`), **not
measured against a live deployment**:

- a missing or invalid bearer is refused with **HTTP 401 at the upgrade** (`volt-routes.ts`), so a revoked
  credential never arrives as a 1008 and redials at the ordinary cadence;
- its only 1008 is `unsupported protocol N` (`volt-relay.ts`), which the bridge answers with the protocol line
  and an hourly redial;
- when a second bridge attaches on the same token it closes the incumbent with **1000
  `replaced by a live bridge`**. That is an ordinary close here: the incumbent logs that line and redials on the
  ordinary backoff. Two bridges on one token therefore take turns evicting each other (see the operational
  note below); each eviction is now at least named in both bridges' logs.

## Errors

**Errors are coded or they are bugs.**

- A pipe failure crosses as its own `code`: the `BridgeErrorCodes` vocabulary in `wire.html`, unchanged.
- An op not on the allowlist, a request id too long to chunk an answer under, and a broken chunked request are
  answered `BAD_REQUEST`. Any other tunnel-side failure (the pipe is gone, the call threw) is answered
  `INTERNAL_ERROR` with the reason.
- **An `INTERNAL_ERROR` message is `<ExceptionType>: <message>`** — on either side of the pipe (`CallFailure`),
  because the message text is OS-localized and the type name is not. The bridge log holds the whole exception
  (stack, inner exceptions). A client that records these messages records what exactly failed (openspec
  `ide-identity-report` 3.1). (A binding failure's message used to end with the Volt assemblies loaded at that
  moment, `[loaded: …]` / `[load conflict: …]`; the CODESYS bridge now ships as one assembly with its
  dependencies merged in, so there is no second copy to report — openspec `codesys-bridge-single-assembly`.)
- A frame the bridge cannot read as a request (not JSON, not an object, an `op` with no string `id`, an `op`
  that is not a string) is **logged and dropped, not answered**. Without an id there is nowhere to send an
  answer, and closing the socket over one bad frame would abandon every request in flight.
- **A request is never dropped.** Every request the bridge accepts gets exactly one terminal frame, or the
  socket closes and the relay fails it. There is no third outcome.

A refused `push` op is **not** an error frame. It is a normal `result` whose `conflicts` name every op that did not
land, because a version conflict is an expected outcome rather than a failure. A relay that treats a non-empty
`conflicts` as an error will report every ordinary edit collision as a bridge fault.

## The bridge log

Local only (see the operational notes); the token is never in it. Per relayed request, exactly two Info lines:

- `relay: <- <op> (<id>)` when the request is read;
- ONE terminal line, whatever ended it: `relay: -> <op> (<id>) <outcome> <N>ms [delivered=no]`, where `<outcome>` is
  - `ok` — for a `push`, `ok landed newProjectVersion=<v>`, `ok landed in part, <N> not newProjectVersion=<v>`,
    `ok rejected` (nothing landed) or `ok nothing to apply`;
  - `error <CODE>` — the coded error the pipe answered (`PLC_DISCONNECTED`, `WRONG_PROJECT`, `IDE_BUSY`, …), or
    `INTERNAL_ERROR` for a call that threw (that case also logs the whole exception at Error);
  - `refused BAD_REQUEST` — an op not on the allowlist, or an id too long to chunk an answer under; refused before
    the pipe;
  - `abandoned [<outcome>]` — the connection went before the terminal frame was sent (a chunked one: before its last
    ack); the op's own outcome follows when it had completed (a push that landed reads `abandoned ok landed
    newProjectVersion=<v>`).

  A chunked answer's line reads `<outcome> <N>ms, <B> B as <n> chunks`. `<N>ms` is the total time from read to
  terminal line (for a chunked answer, to its last ack); the wait for the IDE thread is not split out (the tunnel is a
  pipe client and cannot see it). `delivered=no` is the op's frame not reaching the socket. A send that fails on a
  connection still live is followed by its exception, `delivered=no (<Type>: <message>)`, and the op's outcome
  stands: a push that landed is `ok … delivered=no`, never a failure.

Two Info lines say whether a connection chunks, each true when it is written. When the relay's first frame is not the
announcement: `relay: no chunk announcement yet — this connection sends whole frames until the relay announces chunks`.
When the announcement comes, first or later: `relay: this connection chunks terminal frames over 8192 B, at most <n> B
per message`. A connection whose announcement follows another frame logs both. The chunk WARN lines:

```
relay: ignoring a malformed frame — the relay's announcement …          (changes nothing)
relay: ignoring a second chunk announcement — the connection keeps chunking at most <n> B per message
relay: an ack for nothing — chunk <k> of <id> is not awaiting an ack
relay: ignoring a malformed frame — an ack …
relay: chunk <k> of <id> was not acked within 60s — the relay stopped acking; dropping the socket
relay: chunk <k> of <id> could not be sent (<Type>: <message>) — the relay cannot complete <id>; dropping the socket
relay: refusing chunked request <id> — <reason>; answered BAD_REQUEST, nothing was run
relay: ignoring chunk <k> of <id> — it arrived after <id> was reassembled on this connection
relay: ignoring a malformed chunk — <what>
```

## Known limits

- An ISP that cuts a connection after some bytes in TOTAL is not helped by chunking; the end line's byte counts are
  there to show it. A per-MESSAGE limit is: no chunk is over the `maxBytes` its receiver states.
- The bridge checks a chunked request's trailer as the set's LAST 8 bytes, and the runtime's inflater does not say
  where its deflate data ends. So bytes between the end of the deflate data and the last 8 (junk, or a second member
  of the same frame) and deflate data with no final block pass when the last 8 bytes are the real trailer; the request
  served is the one that CRC32 vouches for (`ChunkFramingTests.Known_divergence_…`).

## What a relay must not do

- **Do not interpret op bodies.** They are Volt's wire, they change with Volt, and a relay that parses them
  becomes a third thing to keep in sync. Route on `id`; pass `body` through.
- **Do not synthesize frames.** If the bridge said nothing, the answer is "the bridge said nothing", not an
  invented `result`. A fabricated success here is a write the caller believes landed.
- **Do not log the token.** It is a remote-write credential for an engineer's live PLC project.
- **Do not close with 1008 for something transient.** It parks every bridge it reaches for an hour.

## Operational notes for whoever runs the relay

These are not protocol requirements. They are the things that go wrong.

- **One bridge per token.** Two bridges on one token is an ambiguity, not a pool. If a second bridge dials in
  on a token that already has one, refusing the second is safer than evicting the first: eviction plus the
  reconnect backoff makes two open IDEs kick each other forever, and a colleague holding a copy of the same
  configuration silently steals the target. `hello` carries `vendor` and `pipe` so the relay can tell its
  client WHICH bridge is attached.
- **Timeouts.** Every `fetch` walks the whole project and a `push` walks it twice. On a large project those
  are seconds, not milliseconds. A relay budget shorter than the work turns a slow success into a reported
  failure, and a push that timed out may well have applied. If the budget expires, "unknown" is the honest
  answer; `refs` afterwards says what actually landed.
- **The bridge's log is local.** It is written to `%LOCALAPPDATA%\Volt\logs` on the engineer's machine; no
  relayable op reads it. Every close, refusal and served op is logged there.

## Configuration (the bridge side)

`volt-relay.json`, beside the host assembly:

```json
{ "url": "wss://relay.example.com/bridge", "token": "…" }
```

A file, not argv or env: the TwinCAT executable is double-clicked (no argv), and a token on a command line is
readable by every process on the machine.

- **Absent** = no tunnel, no behaviour change. A bridge with no sidecar is exactly the bridge without a relay.
- **Malformed** (not JSON, `url`/`token` missing, empty or not strings, `url` not an absolute `ws://`/`wss://`
  URL) = a loud log line at start naming the file. It does not take the bridge down: the bridge keeps serving
  its local pipe with no tunnel.
- **First run of a downloaded bridge.** A download cannot ship a credential, so it may ship a `setup.json`
  (`{ "code": "…", "app": "https://…" }`) instead. When there is no `volt-relay.json` yet, the bridge exchanges
  the one-time code at `<app>/api/bridge/setup/<code>?volt=1` for `{ "url", "token" }` and writes
  `volt-relay.json` from the answer. Any failure is logged and leaves a working local bridge.

## Worked example

`B→R` is a frame from the bridge, `R→B` one from the relay.

```
B→R (upgrade)  Authorization: Bearer abc…
B→R {"hello":{"protocol":1,"volt":"0.0.1.842","vendor":"codesys","pipe":"volt.bridge.codesys.9112"}}

R→B {"id":"r1","op":"refs","protocol":1,"body":{}}
B→R {"id":"r1","progress":{"operation":"refs","done":60,"total":138}}
B→R {"id":"r1","result":{"projectVersion":"9f3c…","items":{…},"applications":[…],"platform":"codesys","projectName":"AWA_Palletizer"}}

R→B {"id":"r2","op":"push","protocol":1,"body":{"ops":[…],"expectedProjectVersion":"9f3c…"}}
R→B {"id":"r3","op":"health","protocol":1}  a second request, in flight at the same time
B→R {"id":"r3","result":{"projects":[…]}}  answers immediately; r2 still holds the IDE
B→R {"id":"r2","result":{"conflicts":[{"name":"Device/Plc Logic/Application/FB_Motor.pou","code":"STALE_ITEM_VERSION",…}],"newItems":{},"removed":[]}}

B→R {"volt":"ping"}
R→B {"volt":"pong"}
```

Note `r2`: rejected, and still a `result`. Nothing was applied.

A large answer, on a relay that announces chunks:

```
B→R {"hello":{…,"chunks":{"maxBytes":8192,"ack":true}}}
R→B {"volt":"relay","chunks":{"maxBytes":8192,"ack":true}}
R→B {"id":"r4","op":"fetch","protocol":1,"body":{}}
B→R (binary) {"id":"r4","seq":0,"count":2,"bytes":61204}\n<gzip slice>   8192 B with its header
B→R (binary) {"id":"r4","seq":1}\n<gzip slice>                           the rest; both fit the 16 KiB window
R→B {"id":"r4","ack":0}
R→B {"id":"r4","ack":1}                                                   r4 delivered
    bridge log: [info] relay: -> fetch (r4) ok 812ms, 61204 B as 2 chunks
```

A bridge from another protocol version:

```
B→R {"hello":{"protocol":1,"volt":"0.0.1.842",…}}
R→B (close 1008 "unsupported protocol 1")
    bridge log: [error] relay: the relay refused this bridge (1008 "unsupported protocol 1"). This bridge speaks
                relay protocol 1 (release 0.0.1.842); the relay serves another. If this is not the latest bridge,
                download it; if it is, the service has not updated yet and nothing on this machine needs changing.
                Trying again in 60 minutes.
```
