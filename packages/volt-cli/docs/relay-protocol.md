# The relay protocol

**Status:** proposed (`openspec/changes/relay-tunnel`). Nothing implements this yet.

This is the whole specification a relay author reads. It defines how a Volt bridge dials OUT to a relay and
serves pipe ops that arrive over it, so a client whose code runs somewhere else — a datacenter, another
machine — can drive an IDE sitting on an engineer's laptop behind NAT.

Volt publishes the protocol and implements the bridge half (`Volt.Relay`). **Volt runs no relay, issues no
tokens and authenticates no one.** The relay, its auth, its users and its own client-facing API belong to
whoever runs it. Volt names no relay and no product.

## Roles

```
your client ──(your own API)──▶ your relay ◀──WSS, dialed OUT by the bridge── Volt.Relay
                                                                                 │ PipeClient, one connection per request
                                                                                 ▼
                                                        volt.bridge.<vendor>.<pid>   (the ordinary named-pipe host)
```

The bridge is the WebSocket **client**. It never listens. A relay that cannot be dialed is a relay with no
bridges; there is no inbound path to an engineer's machine and this protocol does not create one.

`Volt.Relay` forwards each tunneled request to the local bridge pipe as an ordinary pipe call and streams the
frames back. It adds no logic of its own — every guard (`OpGuard`, the disconnect gate, `ifVersion`, the op
allowlist) already lives in the pipe host and applies unchanged, because the tunnel is just another pipe
client. **There is one entry point to the engine and every guard is on it.**

## Connection

The bridge opens ONE WebSocket to the URL it was configured with, sending:

```
Authorization: Bearer <token>
```

The token is opaque bytes to Volt. The relay decides what it means, and is the only party that can.

A relay MAY reject the upgrade (401/403). A relay MUST NOT require any other header — the bridge sends none,
and a `ClientWebSocket` running inside an IDE's scripting host is not a browser.

### Handshake

The bridge's first frame, before any response frame:

```json
{ "hello": { "protocol": 1, "volt": "0.0.1.842", "vendor": "codesys", "pipe": "volt.bridge.codesys.1234" } }
```

| field | meaning |
| --- | --- |
| `protocol` | This document's version. `1`. |
| `volt` | The bridge's own version string, for the relay's logs and support. |
| `vendor` | `codesys` or `twincat`. |
| `pipe` | The local pipe this tunnel serves. Diagnostic — it identifies WHICH IDE on a machine with several. |

There is **no negotiation**. A relay that does not speak `protocol` closes the socket with a reason. A bridge
that is closed during handshake does not retry faster than its normal backoff.

`hello` is sent once per connection, including after every reconnect. It is **not** re-sent when the served
project changes — ask `health` for that; one source of truth.

## Frames

Text frames, one JSON object each. Every frame after `hello` carries an `id`.

**Request** (relay → bridge):

```json
{ "id": "<opaque>", "op": "fetch", "body": { "onlyItems": ["FB_Motor.fb"] } }
```

`id` is the relay's own; the bridge treats it as opaque and echoes it. Uniqueness is the relay's problem. The
bridge does not reuse an `id` it has answered, and a relay that reuses one while the first is in flight gets
two answers it cannot tell apart — don't.

**Response** (bridge → relay): zero or more progress frames, then **exactly one** terminal frame.

```json
{ "id": "…", "progress": { "operation": "fetch", "done": 40, "total": 138 } }
{ "id": "…", "result":   { "projectVersion": "…", "items": { … } } }
{ "id": "…", "error":    { "code": "PLC_DISCONNECTED", "message": "…" } }
```

`progress` and `result` are the pipe's own frames, forwarded verbatim with the id attached — the same shapes
`wire.html` documents for the local pipe. A relay does not need to understand them to route them; a client
does, and reads them there.

A terminal frame ends the request. A relay MUST tolerate zero progress frames (most ops send none) and MUST
NOT assume any relationship between `done`/`total` and time.

## The op allowlist

```
health   logs   refs   fetch   push   build
```

Anything else — including `connect` and `disconnect` — is answered `BAD_REQUEST` **without touching the pipe**.

`connect`/`disconnect` stay local on purpose: a remote party does not get to rebind which project an
engineer's IDE serves. `init` is not an op; it is `fetch` with `init: true`.

The allowlist is enforced by the bridge, not by the relay. A relay is free to expose fewer ops to its own
clients; it cannot expose more.

## Concurrency

One pipe connection per request id. Ops run concurrently to the extent the pipe allows, which is the property
that matters in practice: **`health` and `logs` answer while a `push` or `build` holds the IDE thread.**
Everything else takes the IDE and will queue behind it.

A relay may have many requests in flight on one socket. Frames for different ids interleave freely; a relay
demultiplexes on `id` and nothing else. Frame ORDER is guaranteed only within one id.

## Liveness

- The bridge sends `{"ping":<n>}` every **25 s**, `n` increasing.
- The bridge closes the socket after **60 s** with no frame from the relay, and reconnects.
- A relay SHOULD send something within that window. Any frame counts; a relay with nothing to say can echo
  `{"pong":<n>}`, which the bridge ignores beyond noting traffic.

**Reconnect** is the bridge's job, with capped backoff (1 s → 30 s, jittered). A relay does nothing to
encourage it.

A request in flight when the socket drops **is abandoned**. The bridge does not re-run it and does not answer
it on the new connection. The relay fails it to its own caller. This is safe to retry by design: `ifVersion`
and `expectedProjectVersion` make a repeated push either apply once or reject as stale — never apply twice.

## Errors

**Errors are coded or they are bugs.**

- A pipe failure crosses as its own `code` — the `BridgeErrorCodes` vocabulary in `wire.html`, unchanged.
- A tunnel-side failure (pipe gone, malformed frame, op not on the allowlist) is answered with a code too:
  `BAD_REQUEST` for a frame the bridge cannot route, `INTERNAL_ERROR` with the reason for anything else.
- **A request is never dropped.** Every `id` the bridge accepts gets exactly one terminal frame, or the socket
  closes and the relay fails it. There is no third outcome.

A rejected `push` is **not** an error frame — it is a normal `result` with `accepted:false` and a `conflicts`
list, because a version conflict is an expected outcome rather than a failure. A relay that treats
`accepted:false` as an error will report every ordinary edit collision as a bridge fault.

## What a relay must not do

- **Do not interpret op bodies.** They are Volt's wire, they change with Volt, and a relay that parses them
  becomes a third thing to keep in sync. Route on `id`; pass `body` through.
- **Do not synthesize frames.** If the bridge said nothing, the answer is "the bridge said nothing", not an
  invented `result`. A fabricated success here is a write the caller believes landed.
- **Do not log the token.** It is a remote-write credential for an engineer's live PLC project.
- **Do not hold more than one bridge per token.** Two bridges on one token is an ambiguity, not a pool — see
  below.

## Operational notes for whoever runs the relay

These are not protocol requirements. They are the things that go wrong.

- **One bridge per token.** If a second bridge dials in on a token that already has one, refusing the second
  is safer than evicting the first: eviction plus the reconnect backoff makes two open IDEs kick each other
  forever, and a colleague holding a copy of the same configuration would silently steal the target. `hello`
  carries `vendor` and `pipe` so the relay can tell its client WHICH bridge is attached.
- **Timeouts.** Every `fetch` walks the whole project and a `push` walks it twice. On a large project those
  are seconds, not milliseconds. A relay budget shorter than the work turns a slow success into a reported
  failure — and a push that timed out may well have applied. If the budget expires, "unknown" is the honest
  answer; `refs` afterwards says what actually landed.
- **`logs` is how you find out what happened.** It reads the bridge's own log file, off the IDE thread, and is
  answerable while everything else is stuck. That is exactly when it is needed.

## Configuration (the bridge side)

`volt-relay.json`, beside the host:

```json
{ "url": "wss://relay.example.com/bridge", "token": "…" }
```

A file, not argv or env: the TwinCAT executable is double-clicked (no argv), and a token on a command line is
readable by every process on the machine.

- **Absent** = no tunnel, no behaviour change. A bridge with no sidecar is exactly the bridge that exists today.
- **Malformed** = loud failure at start, naming the file. Never a silently local-only bridge — that failure
  mode looks identical to "the relay is down" from the far end, and the two have different fixes.

## Worked example

```
→ (upgrade)  Authorization: Bearer abc…
← {"hello":{"protocol":1,"volt":"0.0.1.842","vendor":"codesys","pipe":"volt.bridge.codesys.9112"}}

→ {"id":"r1","op":"refs","body":{}}
← {"id":"r1","progress":{"operation":"refs","done":60,"total":138}}
← {"id":"r1","result":{"projectVersion":"9f3c…","items":{…},"folders":{…},"platform":"codesys","projectName":"AWA_Palletizer"}}

→ {"id":"r2","op":"push","body":{"ops":[…],"expectedProjectVersion":"9f3c…"}}
← {"id":"r3","op":"health"}            ← a second request, in flight at the same time
← {"id":"r3","result":{"projects":[…]}}   ← answers immediately; r2 still holds the IDE
← {"id":"r2","result":{"accepted":false,"conflicts":[{"name":"FB_Motor.fb","code":"STALE_ITEM_VERSION",…}]}}

← {"ping":1}
→ {"pong":1}
```

Note `r2`: rejected, and still a `result`. Nothing was applied.
