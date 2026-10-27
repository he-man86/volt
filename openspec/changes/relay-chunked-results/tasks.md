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

- [x] 3.1 `hello` carries `"chunks":{"maxBytes":8192,"ack":true}` (RelayFrames.Hello; existing hello tests updated
      with the reason).
- [x] 3.2 Receive binary chunk messages; ack each at once; reassemble per id; on the last chunk inflate to the exact
      request and serve it as a whole one.
- [x] 3.3 Refusal by name: seq > 0 without seq 0, gap, duplicate, more than `count`, inflate error, length mismatch,
      `bytes` > 64 MiB → WARN plus `BAD_REQUEST` for the id, never served. A partial buffer is discarded when its
      connection ends and never served (test: drop mid-chunks, reconnect, nothing ran).
- [x] 3.4 Built (step 3, 2026-10-27). `ChunkAssembly` (new, per connection) reads each binary message's header, the tunnel
      acks it at once (`{"id","ack":seq}`, before inflating), and the last chunk inflates (stopped one byte past `bytes`)
      and decodes as strict UTF-8 into a frame served exactly as a whole one. `RelayReceived.Binary` and the real
      adapter carry binary messages up. `hello.chunks` = `{"maxBytes":8192,"ack":true}` (`ChunkAssembly.MaxBytes`);
      `Announces_itself_before_anything_else` now pins hello's member list, because hello gained a member.
      Tests first (`ChunkedRequestTests`, 27; the red was a compile failure, so mutations were run instead: a
      reassembly shared across connections alone fails `A_partial_request_is_discarded…`; with seq 0 left unacked too, 23 of 27 fail).
      Refusals by name, each a WARN `relay: refusing chunked request <id> — <reason>; answered BAD_REQUEST, nothing was
      run` and ONE error frame `chunked request refused: <reason>; it was not run`: the seven of 3.3, plus four the
      contract's shape implies — a chunk over the 8192 B the hello states, seq 0 without a positive `count` or `bytes`,
      a chunk with no `seq` (not acked: nothing to name), a reassembled frame that is not a request or names another id.
      A binary message with no header line / no JSON / no string `id` has no one to answer: a WARN `relay: ignoring a
      malformed chunk — …`, like a malformed text frame. Every chunk with an id and a seq is acked, refused or not (an
      unacked chunk would hold the relay's window until it drops the socket); chunks of an id already refused are acked
      and dropped (Debug), of one already reassembled acked and named (WARN), never answered twice.
      The refusal is a new BAD_REQUEST raise site: `Volt.Repo.Gates/WireVocabularyTests` RelayTunnel BAD_REQUEST 2→3.
      **Add to the message to PLC Assist before 6.1** (bridge-side behaviour, none a rule on the relay): the four extra
      refusals above; acks for refused chunks; chunks after a refusal acked and never answered; a chunk repeated after
      its id was reassembled is served once (the extra one arrives after the request already ran — "more than count"
      is refusable only before the last chunk). **Open, for both owners:** the bridge bounds `bytes` (64 MiB) and each
      message (8 KiB), not `count`, so a relay that states a huge `count` makes the bridge hold count × 8 KiB of gzip
      until the connection ends; the relay's own guard (`count × maxBytes ≤ 32 MiB`) has no bridge mirror in the
      agreed list.
      Numbers (step 3): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests 144/144 (3 runs green);
      Volt.Repo.Gates 275/275.
- [x] 3.5 Review fixes (gate step 3, 2026-10-27), each red first (16 failing before the fix, all for the reviewer's
      reason; "no trailer" and "bytes after the member" were SERVED):
      - **One gzip member, decoded by the bridge** (`GzipMember`, a port of zlib's `contrib/puff`). `GZipStream` cannot be
        held to the member's framing: on net48 and net10 it ends without an error when the CRC32/ISIZE trailer is
        missing (a corrupted, trailer-less set was served), and a second member is accepted on net48 but refused on
        net10 (one set, two answers by vendor host). The decoder knows where the deflate data ends, so the bridge now
        requires exactly the contract's "slices concatenated ARE gzip(frame)": the 8-byte trailer present, CRC32 and
        ISIZE verified, nothing after it; the optional header fields (FEXTRA/FNAME/FCOMMENT/FHCRC, the header CRC
        checked) are read past. New refusals, same WARN/BAD_REQUEST form: `end without the whole 8-byte gzip trailer
        (CRC32 and ISIZE): <n> B of it arrived`, `fail the gzip CRC32 check`, `end with ISIZE <n> in the gzip trailer,
        not the <B> B they inflate to`, `carry <n> B after the gzip member`, and `do not inflate (<what>)` names the
        header or deflate defect. Measured in a scratch app (deleted) on both runtimes against the same Volt.Relay.dll:
        valid NoCompression/Fastest/Optimal accepted byte-identical; trailer-less corruption, corruption with trailer,
        5 trailing bytes and two members refused with the same reason on net48 and net10. Cost: a 20 MB request (2.7 MB
        gzip) decodes in 250 ms (net10) / 340 ms (net48), against 21 / 42 ms for `GZipStream` — small beside the
        upload of 2.7 MB. `ChunkFramingTests` round-trips every .NET compression level over four texts (one byte to
        300 KB, Cyrillic, several stored blocks).
      - **Gzip held is bounded by `bytes`:** a set may hold at most 2 × `bytes` + 1 KiB of gzip (stored-block worst case
        is `bytes` + 5 per 64 KiB + 18; the headroom covers header fields, small blocks, fixed-Huffman bytes). Past it,
        `chunk <k> of <id> brings the set to <n> B of gzip, more than the <m> B a gzip of <B> B can take`, before the
        slice is buffered. (3.5b corrects this paragraph: the bound closed the open item for ONE id only, and it is the
        bridge's own limit, not a length mismatch.)
      - **The real adapter keeps at most 8192 B of a binary message** and counts the rest (`RelayReceived.ReadAsync`,
        `RelayReceived.Length`): an oversized chunk is refused by its length on the wire, never held whole in the IDE's
        process. Text frames are unchanged (they were unbounded before this change and are not chunks).
      - **A reused id is a new request, as a whole frame's is** (relay-protocol.md: ids are the relay's and opaque; a
        whole frame reusing one is served). A chunk 0 now starts a new set under an id this connection already
        reassembled or refused; before, the whole set was acked and dropped and the relay waited for nothing. A chunk
        past the end of a reassembled set is still acked, named (`it arrived after <id> was reassembled on this
        connection`) and never answered twice; the tail of a refused set is still dropped at Debug.
        Test replaced: `A_chunk_for_an_id_already_reassembled_is_acked_and_named_and_the_id_is_not_answered_twice`
        pinned a repeated chunk 0 being dropped — the premise the contract's id rule refutes; its "never answered twice"
        half is pinned by `A_chunk_past_the_last_of_a_reassembled_set_is_acked_and_named_and_the_id_is_not_answered_twice`,
        and reuse by `A_set_sent_again_under_an_id_already_served_…` / `…_already_refused_is_a_new_request`.
      **Add to the message to PLC Assist before 6.1:** the four gzip-framing refusals (a relay must send exactly one
      gzip member with its trailer, which a standard gzip writer does); the 2 × `bytes` + 1 KiB gzip bound; an oversized
      chunk is refused by its wire length; a chunk 0 under a reused id is served as a new request.
      Numbers (step 3 fixes): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests 176/176 (3 runs green);
      Volt.Repo.Gates 275/275.
- [x] 3.5b Review fixes (gate step 3, second round, 2026-10-27), tests first in `ChunkAssemblyBoundsTests` (new, on the
      assembly itself); 3 of its 4 red before the fix, each for the reviewer's reason (the round-robin repro held
      2,684,320,000 B; the FEXTRA refusal named "a gzip of 10 B can take"; 306 finished ids remembered, not 256):
      - **The gzip of ALL a connection's unfinished sets is bounded by one frame cap** (`ChunkAssembly.MaxHeldBytes` =
        64 MiB). The per-set bound of 3.5 closed the open item for ONE id only: the tunnel acks every chunk at once, so
        the relay's window bounds what is in flight, never what the bridge holds, and twenty ids at their own bound held
        ~2.6 GiB in the IDE's process (32-bit CODESYS among them). The chunk that would cross it is refused, same
        WARN/BAD_REQUEST form: `chunk <k> of <id> brings this connection's unfinished chunked requests to <n> B of gzip,
        over the 67108864 B (one frame cap) the bridge holds at once`; that set's gzip is released, the others go on
        (`The_gzip_of_all_unfinished_sets_…`, `A_set_that_finishes_or_is_refused_releases_its_gzip…`). Slices are now
        kept at their own length (no `MemoryStream` doubling); the one gzip buffer is built when the last chunk arrives.
        This is a NEW limit the agreed list does not have — it goes to PLC Assist, not into the contract silently.
      - **The per-set bound is named as what it is:** the bridge's own limit, not a property of gzip (a valid member has
        no length bound — header fields, empty blocks; GzipMember reads past FEXTRA/FNAME/FCOMMENT). The refusal now
        reads `chunk <k> of <id> brings the set to <n> B of gzip, over the <m> B this bridge holds for a request of <B> B
        (2 x bytes + 1 KiB)`; a 10 B frame with a 2000 B FEXTRA field is refused by that limit
        (`The_per_set_bound_is_named_as_the_bridge_limit…`). The two Broken() cases in `ChunkedRequestTests` changed
        their expected reason only (premise refuted on grounds independent of the code: the reviewer's valid-gzip
        counterexample); what they refuse is unchanged.
      - **A connection remembers at most 256 finished ids** (`ChunkAssembly.FinishedRemembered`, oldest forgotten
        first; one map + order list replace the two ever-growing sets). A chunk of an id further back is judged on its
        own (a seq > 0 is then "arrived without chunk 0"). `A_connection_remembers_a_bounded_number_of_finished_ids`.
      **Add to the message to PLC Assist before 6.1:** the per-connection 64 MiB bound on held gzip across ids (a relay
      must not have more than that of unfinished chunked requests on one connection); the per-set 2 × `bytes` + 1 KiB
      bound is a bridge limit that a standard gzip writer without large header fields meets; a straggler of an id more
      than 256 finished sets back is answered as a chunk without chunk 0.
      Numbers (gate step 3, VOLT_REQUIRE_FULL=1): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests
      180/180 (3 runs green); Volt.Cli.Tests 377/377; Volt.Engine.Tests 3222 pass + 1 skip; Volt.Connector.Tests
      156/156; Volt.Ide.Twincat.Tests 728/728; Volt.Ide.Codesys.Tests 505/505 (net48); Volt.Contracts.Tests 56/56;
      Volt.Repo.Gates 275/275 (no new raise site: the two new refusals go through the existing chunked BAD_REQUEST);
      volt-cli `bun test test/unit` 225/225; `bun run typecheck` 0; `bun run lint` exit 0 (warnings only, none in changed
      files); `bun run check` exit 0. Delta vs 3.5: Volt.Relay.Tests +4 (176 → 180).

- [ ] 3.6 Mirror the relay's `count` guard (agreed with PLC Assist, 2026-10-27): a chunked request whose seq 0 states
      `count` × 8192 > 32 MiB is refused by name (WARN + BAD_REQUEST, not run) before anything is buffered. Red test
      first.

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
