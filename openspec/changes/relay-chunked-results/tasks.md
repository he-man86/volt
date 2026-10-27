The contract is `design.md`, agreed with PLC Assist on 2026-10-27 (every change goes to them by message first).
Volt owner: "ok go ahead, build it" (2026-10-27). PLC Assist's owner decides the relay side separately. The bridge side
is safe to ship first: it chunks only after a relay announces, and announces only in `hello`. Test-first throughout;
every behaviour gets a red test before code (`Volt.Relay.Tests`, FakeRelay extended for binary messages).

## 1. Contract

- [x] 1.1 Agree the contract with PLC Assist: frames, ack window, limits, the mirror direction and byte accounting
      (design.md).
- [x] 1.2 Volt owner decision: build it.

## 2. Bridge → relay chunks

- [x] 2.1 Socket: `IRelaySocket` sends BINARY messages too; the real adapter and FakeRelay implement it (FakeRelay
      records binary messages apart from text).
- [x] 2.2 Read the relay's announcement (`{"volt":"relay","chunks":{"maxBytes","ack":true}}`) and its acks
      (`{"id","ack":seq}`). Malformed (no or bad maxBytes, `ack` not true, a bad ack) is a WARN by name, and the
      connection stays whole-frame. Per connection; never carried across a reconnect. One Info line says whether the
      connection chunks.
- [x] 2.3 Chunk a terminal frame whose UTF-8 is over 8 KiB, on an announced connection: gzip Optimal, the binary
      header line, every message ≤ maxBytes, `count`/`bytes` on seq 0 only. Reassembled by a test, it is byte for byte
      the whole frame. Small frames stay text.
- [x] 2.4 Window per connection (16–256 KiB, bytes acked over the last 5 s; FIFO across ids; whole frames are not
      counted). Tests: no acks → at most the floor is sent while a `health` answers in between; acks → it grows; an
      ack for nothing → a named WARN.
- [x] 2.5 Stall and delivery. A chunk not acked within the silence limit gets a named WARN, a DropCause, and the socket
      is dropped. The terminal line of a chunked answer: `<outcome> <N>ms, <B> B as <n> chunks`, with N up to the last
      ack. An answer not acked before the drop is `abandoned`.
- [x] 2.6 Review fixes (gate step 2, 2026-10-27), each with its test first in `ChunkedResultTests` / `ChunkWindowTests`:
      - Contract drift reverted: the step had added a first-frame rule and a 1024–16384 bound on `maxBytes` to
        design.md without PLC Assist. Both are gone from design.md AND the code. An announcement turns chunking on
        whenever it arrives (`An_announcement_after_another_frame_still_turns_chunking_on`); the first frame logs only
        what is true then (`no chunk announcement yet — … whole frames until the relay announces chunks`). A second
        announcement is a named WARN and the first stands (the contract announces once). `maxBytes` must be a positive
        integer; over the window floor the bridge sends 16 KiB messages, which is "at most maxBytes"
        (`A_maxBytes_over_the_window_floor_chunks_at_the_floor`).
      - An id that cannot fit a chunk header under maxBytes is refused `BAD_REQUEST` at INTAKE, before the op runs
        (`RelayChunks.IdFits`, worst-case 10-digit `count`/`bytes`); `Split` throwing is now a broken invariant
        (`A_request_whose_id_cannot_fit_a_chunk_header_is_refused_by_name_before_it_runs`).
      - A chunk send that fails on a live connection drops the socket (named WARN + DropCause `a chunk could not be
        sent`): the relay learns by the socket ending and discards the partial answer; no false "ack for nothing"
        (`A_chunk_send_that_fails_after_earlier_chunks_went_drops_the_socket_…`).
      - design.md's ramp corrected to what the formula does: W at most doubles per round, the cap in 5 rounds, ~1.5 s
        at 300 ms RTT, a 20 MB `refs` ~5 s (pinned by `From_a_cold_start_the_window_at_most_doubles_per_round`).
      - The red runs were not re-observed against the pre-fix code (it was uncommitted and is overwritten); each test
        encodes the reviewer's observed repro.
      **Message to PLC Assist before 6.1** (bridge-side behaviour they will see, none of it a rule on the relay): the
      ramp correction; a too-long id answered `BAD_REQUEST` before it runs; a failed chunk send drops the socket; a
      second announcement is ignored; messages capped at 16 KiB when `maxBytes` is larger; the stall check runs on the
      heartbeat tick (fires 60–85 s after the chunk); the terminal log line as 2.5 states it (design.md still says
      `…, acked in <s>` — tasks.md 2.5, in the same agreed commit, was built).
      The intake refusal is a new BAD_REQUEST raise site and `Split`'s throw a new `VoltInvariantException`: both
      censused in `Volt.Repo.Gates/WireVocabularyTests` (RelayTunnel BAD_REQUEST 1→2; RelayChunks invariant 0→1).
      Numbers (gate step 2, VOLT_REQUIRE_FULL=1): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests 117/117
      (3 runs green); Volt.Cli.Tests 377/377; Volt.Engine.Tests 3222 pass + 1 skip; Volt.Connector.Tests 156/156;
      Volt.Ide.Twincat.Tests 728/728; Volt.Ide.Codesys.Tests 505/505 (net48); Volt.Contracts.Tests 56/56;
      Volt.Repo.Gates 275/275; volt-cli `bun test test/unit` 225/225; `bun run typecheck` 0; `bun run lint` exit 0
      (warnings only, none in changed files); `bun run check` exit 0.

## 3. Relay → bridge chunks

- [ ] 3.1 `hello` carries `"chunks":{"maxBytes":8192,"ack":true}` (RelayFrames.Hello; existing hello tests updated
      with the reason).
- [ ] 3.2 Receive binary chunk messages; ack each at once; reassemble per id; on the last chunk inflate to the exact
      request and serve it as a whole one.
- [ ] 3.3 Refusal by name: seq > 0 without seq 0, gap, duplicate, more than `count`, inflate error, length mismatch,
      `bytes` > 64 MiB → WARN plus `BAD_REQUEST` for the id, never served. A partial buffer is discarded when its
      connection ends and never served (test: drop mid-chunks, reconnect, nothing ran).

## 4. Byte accounting

- [ ] 4.1 The connection end line gains `| sent <B> B (largest <B>), received <B> B (largest <B>)` (message payload
      bytes, both kinds). Existing end-line regexes updated with the reason.

## 5. Real sockets

- [ ] 5.1 A test over a real ClientWebSocket through a throttled TCP proxy, against an HttpListener relay that
      announces, acks, reassembles and closes after a scaled silence limit. It needs a large, poorly compressible
      result and a concurrent `health`. Assert: the call completes, the relay never goes silent past its limit, the
      `health` answer waits ≤ W/uplink plus one chunk plus slack, and the reassembled frame is byte-identical. Kept
      under ~20 s so it runs in CI.
- [ ] 5.2 The same test on .NET Framework 4.8 (the CODESYS host's socket stack). x86 as well if a test project
      runs x86 (the TwinCAT worker); otherwise record why not.

## 6. Docs

- [ ] 6.1 Move the contract into `packages/volt-cli/docs/relay-protocol.md`, current implementation only: frames
      (binary chunks, announcement, ack, hello field), liveness/window, errors, the bridge log lines, known limits.
      Remove "there is no binary frame" and "Text frames only". Update `docs/logs.html` if it lists relay lines.
      design.md keeps only what is not in the doc.

## 7. Joint gate

- [ ] 7.1 STOP for the owner: once PLC Assist's relay ships reassembly + the announcement, run a joint gate through a
      2 KB/s proxy: a large fetch plus a concurrent health, and a large push request. Then release.

## 8. Close

- [ ] 8.1 Cold full suites (all C# test projects, volt-cli `bun test test/unit`, typecheck, lint, `bun run check`),
      then archive.
