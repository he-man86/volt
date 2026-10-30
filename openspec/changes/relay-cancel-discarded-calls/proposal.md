> Joint with PLC Assist, whose relay sends the frame. Counterpart: PLCAssist
> `openspec/changes/relay-cancel-discarded-calls/`. The semantics below were agreed between the two sides before
> either was built; this change is the bridge half.

## Why

In the 2 KB/s joint gate the relay timed out a large `fetch` at 300 s, but the bridge kept streaming all 110 chunks of
its answer for 3.5 more minutes. The relay keeps acking those chunks, so the bridge's 60 s ack limit never drops the
socket, and the slow link carries a whole answer nobody waits for. Every other call on that connection shares the same
window and uplink while it does.

The bridge cannot know the relay gave up: the relay has no frame for it. A read is safe to stop (it changes nothing);
a write is not (stopping one leaves its outcome unknown).

## What Changes

- New relay → bridge frame `{"id": "<id>", "cancel": "timeout" | "caller_gone"}` (no `op`, `ack` or `volt`). A cancel
  whose `id` is not a string or whose `cancel` is not one of the two words is a malformed frame, refused by name.
- For a READ (`health`, `refs`, `fetch`, `grep`): queued → never started; running on the pipe → the IDE call finishes
  (never interrupted) and nothing is sent; streaming chunks → no chunk after the one in flight, and its unacked chunks
  stop holding the window and the ack watchdog. Unknown or finished id → a Debug line.
- A cancel for a write (`push`, `build`, anything not a read) breaks the contract: a WARN naming the id and op, and the
  write runs to its end and is answered as ever.
- One terminal log line: `relay: -> <op> (<id>) cancelled (<reason>)[ after <n> of <m> chunks] <N>ms`.
- `packages/volt-cli/docs/relay-protocol.md` gains a "Cancel" section and the `cancelled` outcome.
- Protocol stays 1. An older bridge reads the frame as one it does not know and ignores it (answers the read; the relay
  discards the answer). No caching, no new fallbacks.

## Impact

`Volt.Relay` (`RelayFrames` classifies the frame; `RelayTunnel` tracks each request's state for the cancel;
`ChunkWindow.Cancel`), `docs/relay-protocol.md`, `Volt.Relay.Tests/RelayCancelTests.cs`.
