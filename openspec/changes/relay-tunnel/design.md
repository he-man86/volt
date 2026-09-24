# Relay tunnel — design

## Topology

```
remote client ──(its own API)──▶ relay ◀──WSS, dialed OUT by the bridge──  Volt.Relay
                                                                              │  PipeClient, one connection per request
                                                                              ▼
                                                              volt.bridge.<vendor>.<pid>  (BridgePipeHost, unchanged)
```

`Volt.Relay` is a pipe CLIENT, exactly like the CLI. It runs in the host's process (in-proc in CODESYS, inside
the TwinCAT worker) but talks to its own pipe, not to `BridgePipeHost` directly. That costs a local hop and buys
the property that matters: **there is one entry point to the engine, and every guard is on it.** A tunnel that
called the dispatcher directly would be a second entry point, and the first guard added to only one of them is a
remote write that skips it.

## Protocol (the part a relay implements)

One WebSocket, dialed by the bridge. Text frames, one JSON object each.

**Handshake.** `Authorization: Bearer <token>` on the upgrade request. The bridge's first frame:

```json
{ "hello": { "protocol": 1, "volt": "<version>", "vendor": "codesys|twincat", "pipe": "volt.bridge.codesys.1234" } }
```

**Requests** (relay → bridge): `{ "id": "<opaque>", "op": "<Ops value>", "body": { … } }`

**Responses** (bridge → relay), the pipe's frames tagged with the request id — zero or more progress, then
exactly one terminal:

```json
{ "id": "…", "progress": { … } }
{ "id": "…", "result":   { … } }
{ "id": "…", "error":    { "code": "<BridgeErrorCodes value>", "message": "…" } }
```

- **Allowlist:** `health`, `logs`, `refs`, `fetch`, `push`, `build`. Anything else is answered with `BAD_REQUEST` without
  touching the pipe. `init` is `fetch` with `init: true`; `connect`/`disconnect` stay local — a remote party does
  not get to rebind which project an engineer's IDE serves.
- **Concurrency** is the pipe's: one pipe connection per request id, so `health` answers from cache while a
  `push` holds the IDE thread — the same property the connector relies on.
- **Liveness:** the bridge sends `{"ping":<n>}` every 25 s and drops the socket after 60 s of silence from the
  relay; reconnect with capped backoff (1 s → 30 s). A request in flight when the socket drops is abandoned —
  the relay fails it; `ifVersion` makes the caller's retry safe.
- **Errors are coded or they are bugs.** A pipe `PipeCallException` crosses as its `code`. A tunnel-side failure
  (pipe gone, bad frame) is `INTERNAL_ERROR` with the reason, never a dropped reply.
- **Protocol version** is in `hello`; a relay that does not speak it closes with a reason. No negotiation.

The protocol text lives in `packages/volt-cli/docs/relay-protocol.md` — the only spec a relay author reads.

## Configuration

`volt-relay.json` beside the host (the `.py` for CODESYS, the `.exe` for TwinCAT):

```json
{ "url": "wss://relay.example.com/bridge", "token": "…" }
```

A file, not argv or env: the TwinCAT exe is double-clicked (no argv), and a token on a command line is readable
by every process on the machine. Absent file = no tunnel, no behaviour change. Malformed file = loud failure at
start, naming the file — not a silent local-only bridge.

## Standalone TwinCAT

`VoltBridgeTwincat` without `--xae-pid`:
- reuse the `--list-xae-pids` discovery; exactly one XAE → attach; several → print them and read a choice from the
  console; none → print "waiting for TwinCAT" and poll (the worker already starts degraded and attaches later).
- a visible console window with the VoltLog tail — this IS the UI of a standalone bridge.
- `--xae-pid` keeps its current meaning; the connector path is untouched.
- publish profile: self-contained, single-file, `IncludeNativeLibrariesForSelfExtract`, **not trimmed** (COM late
  binding). Output `dist/TwincatStandalone/VoltBridgeTwincat.exe`.

## The `logs` op

A remote client cannot read the bridge's log file, and "why did the bridge do that" is the first question every
support report asks. So `logs` is a PIPE op — `Ops.Logs`, a DTO pair in `Volt.Contracts/Wire/LogsModels.cs`,
dispatched in `BridgePipeHost` — not something the tunnel answers itself. One entry point, as above.

```json
request:  { "maxBytes": 65536 }                       // optional; default 64 KiB, hard cap 1 MiB
response: { "source": "codesys", "text": "…", "truncated": true, "files": ["codesys-2026-09-22.log"] }
```

- **Served like `health`: never marshalled onto the IDE thread.** It reads a file. A `logs` call made BECAUSE a
  push is stuck must not queue behind that push — that is exactly when it is needed.
- **The host's own source only** (`VoltLog`'s `{source}-{date}.log`), newest file first, continuing into the
  previous day's file when today's is shorter than `maxBytes`. Cut at a line boundary; `truncated` says whether
  older lines exist. Opened with `FileShare.ReadWrite` — VoltLog is appending to it.
- **No log file yet** (logging disabled, fresh install) = `{ text: "", files: [] }`. That is a real answer, not an
  error. An unreadable file IS an error (`INTERNAL_ERROR` naming the file) — never an empty string that reads as
  "nothing happened".
- **Not gated by `disconnect`**, same as `health`: a disconnected bridge is precisely one whose logs you want.
- **What it exposes:** project and item names, file paths, error text — what the log already holds. That goes to
  the token holder, who can already `fetch` the whole project; nothing new leaks. The one thing that must never
  be in it is the token: `Volt.Relay` logs the relay URL's host, never the token or the full sidecar.

## Open questions

1. `Volt.Relay` needs `ClientWebSocket` on net48 inside CODESYS. It exists in the framework (`System.Net.WebSockets`,
   Windows 8+); verify it loads under CODESYS's IronPython host before building on it — first task.
2. Should the tunnel report `hello` again when the served project changes, or is `health` over the tunnel enough?
   Default: `health` is enough; one source of truth.
