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
{ "hello": { "protocol": 1, "volt": "0.0.1.842", "vendor": "codesys", "pipe": "volt.bridge.codesys.1234" } }
```

| field | meaning |
| --- | --- |
| `protocol` | This document's version. `1` (`RelayFrames.Protocol`). |
| `volt` | The bridge's release, for the relay's logs and support — the same value `health.bridgeVersion` carries (`BridgeRelease`): the stamped version of a release build (`0.0.1.842`), or `(dev) <commit>` for an unstamped one (`(dev)` alone only when its file states no commit). Empty only when the bridge cannot read its own file. It was the assembly version, `1.0.0.0` on every unstamped build. |
| `vendor` | `codesys` or `twincat`. |
| `pipe` | The local pipe this tunnel serves. Diagnostic: it identifies WHICH IDE on a machine with several. |

There is **no negotiation**, and no acknowledgement of `hello`. A relay that will not serve this bridge (for
example because it does not speak `protocol`) closes the socket with **1008 and a reason**; see
[Closing a bridge](#closing-a-bridge).

`hello` is sent once per connection, including after every reconnect. It is **not** re-sent when the served
project changes; ask `health` for that. One source of truth.

## Frames

Text frames, one JSON object each. There is no binary frame. A frame may be large (a `fetch` or `refs` result on
a big project is megabytes) and arrives in as many WebSocket fragments as it needs; the bridge reassembles to
the end of the message before parsing.

**Request** (relay → bridge):

```json
{ "id": "<opaque>", "op": "fetch", "body": { "onlyItems": ["FB_Motor.pou"] } }
```

`id` is the relay's own, a JSON string; the bridge treats it as opaque and echoes it. Uniqueness is the relay's
problem: a relay that reuses an id while the first is in flight gets two answers it cannot tell apart.

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

**Anything else** from the relay (a frame with no `op`: a pong, a keepalive, a field from a newer relay) is
ignored, but counts as traffic for the watchdog.

## The op allowlist

```
health   refs   fetch   push   build
```

Anything else, including `connect` and `disconnect`, is answered `BAD_REQUEST` **without touching the pipe**.

`connect`/`disconnect` stay local on purpose: a remote party does not get to rebind which project an
engineer's IDE serves. `init` is not an op; it is `fetch` with `init: true`.

The allowlist is enforced by the bridge (`RelayFrames.Allowed`, built from the `Ops` constants), not by the
relay. A relay is free to expose fewer ops to its own clients; it cannot expose more.

## Concurrency

One pipe connection per request id. Ops run concurrently to the extent the pipe allows, which is the property
that matters in practice: **`health` answers while a `push` or `build` holds the IDE thread.** Everything else
takes the IDE and queues behind it.

A relay may have many requests in flight on one socket. Frames for different ids interleave freely; a relay
demultiplexes on `id` and nothing else. Frame ORDER is guaranteed only within one id.

## Liveness

- The bridge sends the constant text frame `{"volt":"ping"}` every **25 s**. It never varies, so a hosted relay
  can answer it at its edge (an exact-match auto-response) without waking whatever owns the connection.
- A relay SHOULD answer with the constant `{"volt":"pong"}`. The bridge correlates nothing: the pong exists
  only to be traffic. Any frame from the relay counts.
- On each 25 s tick, if the bridge has had **no frame from the relay for more than 60 s**, it drops the socket
  (no close handshake) and reconnects. Silence is therefore noticed 60–85 s after the last frame.

A request in flight when the socket drops **is abandoned**. The bridge does not re-run it and does not answer
it on the new connection. The relay fails it to its own caller. This is safe to retry by design: `ifVersion`
and `expectedProjectVersion` make a repeated push either apply once or reject as stale, never apply twice.

## Closing a bridge

Reconnecting is the bridge's job; a relay does nothing to encourage it. What the relay CAN choose is how it
ends a connection, and the bridge reads that choice.

| How the connection ended | Bridge log line | Next dial |
| --- | --- | --- |
| Close **1008** with a reason | ERROR: `relay: the relay refused this bridge (1008 "<reason>").` When the reason contains `protocol`, it adds: `This bridge speaks relay protocol 1, which the relay does not serve: download the latest bridge.` It ends `Trying again in 60 minutes.` | after **1 hour** (+ up to 1 s jitter) |
| Close with any other status (1000, 1001, 1011, …) | INFO: `relay: the relay closed the connection: <status> "<description>"` | ordinary backoff |
| No close at all (1006: the flow died, the relay restarted, or the watchdog dropped it) | WARN: `relay: connection ended (<exception>): <message>` | ordinary backoff |
| Upgrade refused (HTTP 401/403) | WARN: `relay: connection ended (WebSocketException): <message>`. On .NET (the TwinCAT worker) the message names the HTTP status; the CODESYS host's .NET Framework socket may report only that it could not connect. | ordinary backoff |

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

**A refused credential is a 401, not a 1008.** A bad bearer token fails the HTTP upgrade inside the connect
call and never reaches a close frame, so it takes the ordinary backoff (a redial every 30 s). A relay that
wanted a bad token treated as final would have to accept the upgrade and close with 1008, which the bridge
would then log as a refusal and retry hourly.

### One relay, read from its code

The rules above were written against PLC Assist's relay, read from its source (`infra/relay-worker/src/`), **not
measured against a live deployment**:

- a missing or invalid bearer is refused with **HTTP 401 at the upgrade** (`volt-routes.ts`), so a revoked
  credential never arrives as a 1008 and redials at the ordinary cadence;
- its only 1008 is `unsupported protocol N` (`volt-relay.ts`), which the bridge answers with the download hint
  and an hourly redial;
- when a second bridge attaches on the same token it closes the incumbent with **1000
  `replaced by a live bridge`**. That is an ordinary close here: the incumbent logs that line and redials on the
  ordinary backoff. Two bridges on one token therefore take turns evicting each other (see the operational
  note below); each eviction is now at least named in both bridges' logs.

## Errors

**Errors are coded or they are bugs.**

- A pipe failure crosses as its own `code`: the `BridgeErrorCodes` vocabulary in `wire.html`, unchanged.
- An op not on the allowlist is answered `BAD_REQUEST`. Any other tunnel-side failure (the pipe is gone, the
  call threw) is answered `INTERNAL_ERROR` with the reason.
- A frame the bridge cannot read as a request (not JSON, not an object, an `op` with no string `id`, an `op`
  that is not a string) is **logged and dropped, not answered**. Without an id there is nowhere to send an
  answer, and closing the socket over one bad frame would abandon every request in flight.
- **A request is never dropped.** Every request the bridge accepts gets exactly one terminal frame, or the
  socket closes and the relay fails it. There is no third outcome.

A rejected `push` is **not** an error frame. It is a normal `result` with `accepted:false` and a `conflicts`
list, because a version conflict is an expected outcome rather than a failure. A relay that treats
`accepted:false` as an error will report every ordinary edit collision as a bridge fault.

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

R→B {"id":"r1","op":"refs","body":{}}
B→R {"id":"r1","progress":{"operation":"refs","done":60,"total":138}}
B→R {"id":"r1","result":{"projectVersion":"9f3c…","items":{…},"folders":{…},"platform":"codesys","projectName":"AWA_Palletizer"}}

R→B {"id":"r2","op":"push","body":{"ops":[…],"expectedProjectVersion":"9f3c…"}}
R→B {"id":"r3","op":"health"}              a second request, in flight at the same time
B→R {"id":"r3","result":{"projects":[…]}}  answers immediately; r2 still holds the IDE
B→R {"id":"r2","result":{"accepted":false,"conflicts":[{"name":"FB_Motor.pou","code":"STALE_ITEM_VERSION",…}]}}

B→R {"volt":"ping"}
R→B {"volt":"pong"}
```

Note `r2`: rejected, and still a `result`. Nothing was applied.

A bridge from another protocol version:

```
B→R {"hello":{"protocol":1,…}}
R→B (close 1008 "unsupported protocol 1")
    bridge log: [error] relay: the relay refused this bridge (1008 "unsupported protocol 1"). This bridge speaks
                relay protocol 1, which the relay does not serve: download the latest bridge. Trying again in 60 minutes.
```
