The semantics were agreed with PLC Assist before building (their relay sends the frame; the read set is exactly
`health`, `refs`, `fetch`, `grep` — Volt has no `show` wire op). Test-first: every behaviour below had a red test in
`Volt.Relay.Tests/RelayCancelTests.cs` before the code.

## 1. The frame

- [x] 1.1 `RelayFrames.Read` classifies `{"id","cancel"}` (no `op`) as `RelayInboundKind.Cancel`, before the ignorable
      fallback; a non-string `id` or a `cancel` other than `timeout` / `caller_gone` is `Malformed` with a named reason.
- [x] 1.2 `RelayFrames.Cancellable`: the reads, built from `Ops`.

## 2. The bridge

- [x] 2.1 Each request read is a `Call` with a state (queued, running, answering, streaming); a cancel and the step it
      races change under the call's lock.
- [x] 2.2 Queued: the pipe call never starts. Running: the IDE call finishes; no progress or terminal frame is sent.
- [x] 2.3 Streaming: `ChunkWindow.Cancel` drops the queued chunks, frees the unacked ones from the window and the ack
      watchdog, and treats their late acks as expected.
- [x] 2.4 Unknown / finished id, or an answer already going out: a Debug line. A write: a WARN, and the write runs and is
      answered.
- [x] 2.5 Terminal line `relay: -> <op> (<id>) cancelled (<reason>)[ after <n> of <m> chunks] <N>ms`.

## 3. Contract and gates

- [x] 3.1 `docs/relay-protocol.md`: the "Cancel" section and the `cancelled` outcome.
- [x] 3.2 `dotnet test` Volt.Relay.Tests, Volt.Repo.Gates, Volt.Cli.Tests green.

## 4. Joint verification

- [x] 4.1 Throttled rerun of case 1 (large fetch at 2 KB/s, relay timeout) against PLC Assist's relay with both builds:
      the bridge stops streaming after the cancel and logs `cancelled (timeout) after <n> of <m> chunks`.
      2026-11-01, 0.1.18308, CODESYS 3.5.21.40 on the Lenze copy, 2000 B/s proxy: bridge `-> fetch (r-d4a884af) cancelled
      (timeout) after 64 of 110 chunks 299981ms`; relay `rpc_cancel_sent` chunksIn 62 (2 still in the proxy queue);
      healths 1–3 ms at the bridge throughout, 555–682 ms at the caller right after (≈8 s during the transfer).
      Case 4 (proxy dropped 120 s into a fetch): `abandoned ok … delivered=no`, caller `BRIDGE_DISCONNECTED`, redial
      through the restarted proxy on the same pipe, healths answered.
