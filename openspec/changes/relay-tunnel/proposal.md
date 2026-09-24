# Relay tunnel — let a remote client drive a bridge through an OUTBOUND connection

## Why

A bridge today is reachable only from the same machine: a local named pipe, no listening port. That is right for
the CLI and the connector, and it rules out every client that is not on the engineer's machine — a hosted tool
whose code runs in a datacenter and has to reach the IDE on a laptop behind NAT.

The first such client exists (PLC Assist, a hosted AI chat, already running its own bridges over a Cloudflare
relay). Its bridges are the buggy half of that product; Volt's engine is the correct half of this one. Rather
than port Volt's engine into someone else's bridge, **Volt gains one generic capability: a bridge can dial OUT
to a relay and serve pipe ops that arrive over it.** The relay, its auth and its users belong to whoever runs it.

## What this change is

1. **A tunnel protocol, defined here** — the pipe wire's own frames plus a request `id`, over one outbound
   WebSocket. Volt publishes the protocol; a relay implements it. Volt names no relay and no product.
2. **`Volt.Relay`** (`netstandard2.0`, references `Volt.Contracts` + `Volt.Wire` only) — the tunnel client. It
   forwards each tunneled request to the local bridge pipe as an ordinary `PipeClient` call and streams the
   frames back. It adds no logic of its own: every guard (`OpGuard`, the disconnect gate, `ifVersion`) already
   lives in `BridgePipeHost` and applies unchanged.
3. **Both hosts can start it**, from one sidecar file (`volt-relay.json`: `url` + `token`) beside the host:
   - CODESYS: `start_volt_codesys.py` starts the tunnel after `PipeHost.Start` when the sidecar is present.
   - TwinCAT: `VoltBridgeTwincat` gains a **standalone mode** — run without `--xae-pid` (double-click): attach to
     the one running XAE, list and ask when there are several, wait when there are none — and starts the tunnel
     when the sidecar is present. Published as ONE self-contained file.

4. **A `logs` op** — the tail of the host's own VoltLog file. A remote client has no other way to see why a bridge
   misbehaved: the file sits on a machine it cannot reach. It is a pipe op (in `Ops`, served by
   `BridgePipeHost`), so the CLI and connector can use it too; the tunnel just allows it.

5. **`refs` lists library signature items.** `AppendLibrarySignatures` has exactly one call site —
   `FetchService.cs:229` — so a client that has only called `refs` cannot enumerate a project's referenced
   libraries at all. A remote client wants that list without pulling bodies: it is answering "what does this
   project reference?", not reading code. `refs` gains the listing and does **not** gain rendering — bodies stay
   in `fetch`, because `refs` shares its walk with the push receipt (`ProjectSnapshot`) and rendering every
   signature there would put that cost on every push.

   Tasks need nothing: `.task` is a real tree node resolved by kind, so `MainTask.task` is already an ordinary
   item in the `refs` walk, and a client fetches that one item when it wants the cycle time and the programs it
   calls.

## The protocol document

`packages/volt-cli/docs/relay-protocol.md` — written before the code, and the only file a relay author reads.
It is deliberately implementable without reading any Volt source.

## The relay is somebody else's deployment

Worth stating because the first consumer already runs a relay that does something else. Its existing worker
speaks an HTTP-shaped framing (`{id, method, path, body}` out, `{id, status, body}` back, token in the URL
path, a literal `"ping"` string) and resolves a request on the FIRST frame carrying its id. This protocol's
progress frames are structurally incompatible with that last part — the first `{id,progress}` would resolve the
caller with a progress tick as the body.

So a consumer migrating an existing relay stands up a **second, parallel** relay rather than teaching one
deployment both framings. That keeps the old one serving old bridges untouched while the new one is proven, and
it is the consumer's concern entirely — Volt's side is identical either way. Recorded here only so nobody
designs a version-negotiation handshake into this protocol to solve a problem that belongs on the other side of
the socket.

## The invariant this touches, stated honestly

ARCHITECTURE.md: *"The wire is a local named pipe, never a network socket — there is no listening port and no
browser-reachable surface, so a web page can't drive `push`."* After this change:

- **Still true:** no listening port, ever. The tunnel only dials out. Without a sidecar nothing changes at all.
- **No longer true without qualification:** a remote party CAN drive `push` — the one holding the token for a
  relay the engineer pointed their bridge at. That is the feature. The bullet is rewritten to say exactly this,
  not deleted.

## What this is not

- **Not a backend.** Volt runs no relay, issues no tokens, authenticates no one. The token is opaque bytes Volt
  sends in the handshake; the relay decides what it means.
- **Not an integration with a product.** No PLC Assist name, URL or behaviour in Volt code. The sidecar is Volt's
  own file format; a consumer supplies it (e.g. a download that writes it into a zip).
- **Not the connector.** The tray is not involved in v1. Hosting the tunnel in the connector (one tunnel for every
  IDE on the machine) is a natural later step and is left out until a consumer needs it.
- **Not a new op vocabulary — with one exception.** Tunneled requests are pipe requests; `Ops` is the allowlist.
  The exception is `logs` (item 4 above), added to `Ops` itself so it is a pipe op for every client, not a tunnel-only
  side door.
