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

- [x] 3.6 Mirror the relay's `count` guard (agreed with PLC Assist, 2026-10-27): a chunked request whose seq 0 states
      `count` × 8192 > 32 MiB is refused by name (WARN + BAD_REQUEST, not run) before anything is buffered. Red test
      first.
      Built (step 3 fix, 2026-10-27): `ChunkAssembly.MaxCount` = 32 MiB / 8192 = 4096, checked at chunk 0 right after
      `count` is read: `chunk 0 of <id> states <n> chunks: <n> x 8192 B is over the 33554432 B (32 MiB) a chunked request
      may take`. Red first: `A_count_over_the_relays_guard_is_refused_at_chunk_0_before_anything_is_held`
      (ChunkAssemblyBoundsTests: 4097 refused with HeldBytes 0, 4096 held) and a `Broken()` case (tunnel: WARN +
      BAD_REQUEST, acked, not run). Three existing tests stated `count` int.MaxValue to reach a LATER bound; the guard
      now refuses that count first (premise refuted by the agreed guard, not by the code), so they state 4096, the most
      it lets through — the two per-set-bound `Broken()` cases and the round-robin repro of 3.5b; their expected
      reasons are unchanged. Same raise site: WireVocabularyTests census unchanged.
- [x] 3.7 Owner, 2026-10-27: "dont want to reinvent the wheel". DELETE `GzipMember` (the 331-line port of zlib's
      puff). Inflate with the runtime's `GZipStream` (stop one byte past `bytes`), then check the gzip trailer
      ourselves, exactly as PLC Assist's relay does: the set's last 8 bytes are CRC32 (= CRC32 of the output) and ISIZE
      (= `bytes`). A missing trailer, a bad CRC, trailing bytes and a second member all fail that check (the trailer
      read is then not the real one), with the same named refusals as today. CRC32 comes from the runtime if net48 and
      netstandard2.0 have one; otherwise use the standard table-driven CRC-32 (IEEE 802.3), ~15 lines, pinned by its
      published check value (CRC32("123456789") = 0xCBF43926). Every existing refusal test stays green, unchanged.
      Built (step 3 fix, 2026-10-27): `GzipMember.cs` deleted; `Gzip.cs` (header read, kept from it) + `Crc32.cs` (table
      CRC-32 — no runtime one: System.IO.Hashing is a package, a second DLL in the IDE). **Not `GZipStream`, for the
      owner to confirm:** measured in a scratch app (deleted) on net48 and net10, GZipStream checks the trailer ITSELF
      and refuses a bad CRC/ISIZE with its own message (net10 "The archive entry was compressed using an unsupported
      compression method.", net48 the OS language — Dutch here), so "fail the gzip CRC32 check" could never be the
      bridge's; and it inflates a second member on net10 but not on net48. So the bridge reads the header, hands the
      runtime's `DeflateStream` only the bytes between it and the last 8 (stopping one byte past `bytes`), and checks
      those 8 as CRC32 + ISIZE — the same runtime inflater, no framing for it to judge. Measured with the built
      Volt.Relay.dll: all 13 shapes (valid Optimal/Fastest/stored, flipped CRC, wrong ISIZE, no/cut trailer, +5 B, two
      members same/other, stored without trailer, not gzip, bad deflate) give the IDENTICAL answer on net48 and net10; a
      20 MB request (3.2 MB gzip) inflates in 60 ms (net10) / 73 ms (net48), against 250 / 340 ms for GzipMember.
      **Tests that could not stay unchanged** (the owner's "same named refusals" and "tests unchanged" conflict here):
      without its own inflater the bridge cannot know where the deflate data ends, so the refusals that named it are
      gone. "no trailer", "a corrupted payload with no trailer", "a cut trailer" (were `end without the whole 8-byte
      gzip trailer … <n> B of it arrived`) and "bytes after the gzip member" (was `carry 5 B after the gzip member`) now
      expect `fail the gzip CRC32 check` — what the owner's 3.7 text says they do; still refused, BAD_REQUEST, not run.
      New cases: "a second gzip member of another frame" (CRC32 check) and "too short for a gzip header and its trailer"
      (`are <n> B, too short for their <h> B gzip header and the 8-byte trailer (CRC32 and ISIZE)`). The case "two gzip
      members" (the SAME frame twice) is no longer refused: both trailers are equal, so the last 8 bytes pass and the
      first member's frame is served, on both runtimes. Moved to
      `ChunkFramingTests.Known_divergence_a_second_gzip_member_of_the_same_frame_is_served_as_the_first` (fails when it
      starts being refused) and design.md Known limits — **for the owner**: the 3.7 text says a second member fails the
      check; it does only when it is another frame. `do not inflate (<what>)` from the deflate data now reads `the
      deflate data is not valid` (the runtime's message is its own and localized); header defects keep their names
      (the FHCRC test is unchanged). Red first: 9 failing before the fix (the 7 reason/case changes above, the count
      guard twice), the CRC32 check-value test a compile failure.
      Numbers (step 3 fix): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests 188/188 (3 runs green; it
      includes 2 tests of the uncommitted §4 work in the working copy); Volt.Repo.Gates 274/275 — the one red is
      `WireVocabularyTests.Invariants_only_go_down` (RelayTunnel invariants census 1, found 3), raised by the
      uncommitted §4 byte-accounting edits in RelayTunnel.cs (two `?? throw new VoltInvariantException`), not by 3.6/3.7.
- [x] 3.8 Review fixes (gate step 3, third round, 2026-10-27):
      - **The unchecked class is named whole, not one shape.** The runtime's inflater does not say where its deflate
        data ends, so ANY bytes between the end of the deflate data and the last 8 (junk, or a second member of the
        same frame) and an unterminated deflate stream (no final block) pass when the last 8 are the real trailer; the
        frame served is the one that CRC32 vouches for. design.md (the framing bullet and Known limits) and the
        `Gzip` summary now say so; two more known divergences pinned beside the same-frame one:
        `Known_divergence_bytes_between_the_deflate_data_and_the_trailer_are_not_seen` and
        `Known_divergence_deflate_data_with_no_final_block_is_served` (they fail when the set starts being refused).
      - **The runtime-exception branch is pinned:** a `Broken()` case with a valid header, block type 3 and the real
        trailer expects the full reason `the chunks of r1 do not inflate (the deflate data is not valid)`; "an inflate
        error" now pins its full reason `(not a gzip header)`. Red shown by mutation: with the `InvalidDataException`
        catch made inert, exactly that case fails (1 of 66 in the chunk tests).
      - Comment in the connection-bound test corrected: 20 x 4096 x 8000 B ≈ 625 MiB, not ~2.6 GiB.
      - **Open for the owner (not ticked by this gate, one item):** 3.7's text says "the same named refusals as today"
        and "every existing refusal test stays green, unchanged" AND that a missing trailer, trailing bytes and a second
        member "all fail that check". Both cannot hold without an inflater of our own. Built to the second half: four
        expectations changed to `fail the gzip CRC32 check` (no trailer, corrupted with no trailer, cut trailer, bytes
        after the member — the last now only when the bytes are not followed by the real trailer), and "two gzip
        members" of the same frame inverted into a known divergence, with the two shapes above in the same class.
        Default taken (memory: don't stall on a pending choice): committed as built; if the owner wants the old named
        refusals back, that needs the deflate end, i.e. an inflater of our own — the one 3.7 deleted.
      - §4's uncommitted byte-accounting work was set aside (scratchpad) for this gate and restored after the commit; it
        is not part of this commit, and the Repo.Gates red of 3.7 belonged to it.
      Numbers (gate step 3, VOLT_REQUIRE_FULL=1): `dotnet build Volt.sln -c Release` 0 errors;
      Volt.Relay.Tests 188/188 (3 runs green; §4's 3 tests out, these 3 in); Volt.Cli.Tests 377/377; Volt.Engine.Tests
      3222 pass + 1 skip; Volt.Connector.Tests 156/156; Volt.Ide.Twincat.Tests 728/728; Volt.Ide.Codesys.Tests 505/505
      (net48); Volt.Contracts.Tests 56/56; Volt.Repo.Gates 275/275 (green again: the §4 red is not in this tree);
      volt-cli `bun test test/unit` 225/225; `bun run typecheck` 0; `bun run lint` exit 0 (warnings only, none in
      changed files); `bun run check` exit 0. Delta vs 3.5b: Volt.Relay.Tests +8 (180 → 188).

## 4. Byte accounting

- [x] 4.1 The connection end line gains `| sent <B> B (largest <B>), received <B> B (largest <B>)` (message payload
      bytes, both kinds). Existing end-line regexes updated with the reason.
      Built (step 4, 2026-10-27): `ByteCount` per direction on each `Connection`; a text frame counts its UTF-8, a binary
      message its length on the wire, a close nothing; a dial that never connected states `sent 0 B (largest 0),
      received 0 B (largest 0)`. Tests: `The_end_line_counts_the_payload_bytes_each_way_…`,
      `Each_connection_counts_only_its_own_bytes_…`, `The_end_line_counts_binary_chunks_with_the_text_frames_each_way`.
      The seven existing end-line regexes gained the accounting (they pin cause and order, not the numbers).
- [x] 4.2 Review fixes (gate step 4, 2026-10-27), red shown by mutation (the tests were written against uncommitted §4
      code; each mutation below fails exactly the named tests, all green on the fix):
      - **The real adapter's text length is pinned.** `ChunkFramingTests`' 40,000-byte text case asserts `Length`, and
        `A_text_frame_with_a_byte_that_is_not_utf8_has_the_length_that_arrived` (`{`,0xFF,`}`: 3 B arrived, 5 B as
        decoded UTF-8). Mutation "return `Frame(text)`" fails the second; "length 0" fails both.
      - **A failed or stalled send counts nothing, asserted exactly:** the stalled-send test
        (`A_send_that_stalls_is_named_and_the_connection_dropped`) and the chunk-failure test
        (`A_chunk_send_that_fails_after_earlier_chunks_went_…`; the finding named its sibling, which has no end line —
        this is the one that does) now assert `sent` = the UTF-8 of `relay.Received` plus the binary messages that
        reached the relay, and the largest of those. Mutation "count before the send" fails both.
      - **Received bytes count as they arrive, not when a message is whole** (principle: the line exists to measure an
        ISP that cuts a connection mid-flow, so it counts what crossed, not what completed). `IRelaySocket.ReceiveAsync`
        takes an `arrived` callback; `RelayReceived.ReadAsync` reports each read's bytes before the message ends;
        `ByteCount` keeps the message in progress, so a cut message is also the largest when it is. Tests:
        `Each_reads_bytes_are_reported_as_they_arrive_even_when_the_message_never_completes` (adapter level) and
        `A_message_cut_partway_counts_the_bytes_that_arrived_before_the_cut` (tunnel, `FakeRelay.DieMidMessage`).
        Mutation "count on the whole message" fails the tunnel test. Sent stays counted on completion — what a stalled
        send put on the wire is not knowable above the socket — and relay-protocol.md and design.md now say both rules
        and that a counted send was handed to the OS, not proven delivered.
      - **No new invariants.** §4's two `?? throw new VoltInvariantException` (a connection or a socket with no record
        of its dial) are gone by construction: the reconnect loop makes each `Connection` and passes it in, and the open
        socket lives on its `Connection` (`_socket` field removed), so a send reads the socket and its connection as one.
        `WireVocabularyTests.Invariants_only_go_down` green with the census unchanged (RelayTunnel 1).
      **Add to the message to PLC Assist before 6.1:** the bridge counts received bytes read by read (a cut message
      counts what arrived) and a sent message once its socket took it whole.
      Numbers (gate step 4, VOLT_REQUIRE_FULL=1): `dotnet build Volt.sln -c Release` 0 errors; Volt.Relay.Tests 194/194
      (3 runs green); Volt.Cli.Tests 377/377; Volt.Engine.Tests 3222 pass + 1 skip; Volt.Connector.Tests 156/156;
      Volt.Ide.Twincat.Tests 728/728; Volt.Ide.Codesys.Tests 505/505 (net48); Volt.Contracts.Tests 56/56;
      Volt.Repo.Gates 275/275; volt-cli `bun test test/unit` 225/225; `bun run typecheck` 0; `bun run lint` exit 0
      (warnings only, none in changed files); `bun run check` exit 0. Delta vs 3.8: Volt.Relay.Tests +6 (188 → 194: §4's
      three, the review's three).

## 5. Real sockets

- [x] 5.1 A test over a real ClientWebSocket through a throttled TCP proxy, against an HttpListener relay that
      announces, acks, reassembles and closes after a scaled silence limit. It needs a large, poorly compressible
      result and a concurrent `health`. Assert: the call completes, the relay never goes silent past its limit, the
      `health` answer waits ≤ W/uplink plus one chunk plus slack, and the reassembled frame is byte-identical. Kept
      under ~20 s so it runs in CI.
      Built (step 5, 2026-10-27), no product code changed: `test/shared/RelayRealSocketTests.cs`, linked into
      `Volt.Relay.Tests` (net10) and `Volt.Ide.Codesys.Tests` (net48). A real `RelayTunnel` with its default
      `ClientWebSocketAdapter` dials `ws://localhost:<proxy>` → `ThrottledProxy` (16 KiB/s each way, paced 1 KiB reads, so
      the rest queues in the OS socket buffers) → `HttpListenerRelay` (announces maxBytes 8192, answers pings, acks each
      chunk at once, reassembles with GZipStream, closes 1011 after 8 s with no WHOLE message). The bridge pipe is a
      plain `PipeServer`: `fetch` answers 195,000 random bytes base64'd (a 280,609 B frame), `health` a small answer.
      Scale: the protocol's numbers 7.5× down in time (relay silence 8 s, ping 3 s, bridge watchdog 8 s). The expected
      frame is `RelayFrames.Result("r1", <the pipe's own fetch answer>)`; the window bound is restated from design.md
      (floor 16 KiB, cap 256 KiB, 5 s span), not read from the bridge: bound = (max(16 KiB, 5 s × link + one chunk) + one
      chunk) / link + 2 s slack = 8.0 s.
      Two tests, two classes (xunit runs them in parallel, ~15 s wall):
      `RealSocketChunkedTests.A_large_answer_over_a_slow_real_socket_keeps_the_relay_alive_and_a_concurrent_health_answers_within_the_window`
      (a `health` as the first chunk lands — window at its floor — and a second 4 s after the first answered — window
      grown), and the control `RealSocketWholeFrameTests.Without_an_announcement_the_same_answer_over_the_same_link_starves_the_relay_past_its_silence_limit`,
      which proves the link really is slow enough to break a whole frame (otherwise the first test asserts nothing).
      Numbers (net10.0.12 x64, three runs): 280,609 B as 25 chunks, largest message 8,192 B, answer in 12.2–12.3 s;
      health waited 1.0 s (floor: 16 KiB / 16 KiB/s) and 5.0–5.5 s (grown window: ~5 s of link, as design.md predicts),
      bound 8.0 s; longest relay silence 0.5–0.6 s (limit 8 s); reassembled frame byte-identical. Control: relay closed
      for silence at 8.0–8.1 s, the whole answer never arrived. Terminal line `-> fetch (r1) ok 12249ms, 280609 B as 25
      chunks`. Volt.Relay.Tests 194 → 196, all green.
      Gate review (step 5), fixed:
      - CI never ran `Volt.Relay.Tests` (ci.yml's suite loop listed seven suites, not it), so the net10 real-socket test
        and the rest of the relay suite ran by hand only. Red first: `Volt.Repo.Gates/CiRunsEveryTestSuiteTests` (every
        project under `packages/volt-cli/test` that references the test SDK is in that loop) failed naming
        `Volt.Relay.Tests`; added to the loop, green.
      - The test relay checked only part of the chunk contract (seq 0's `bytes` unread, no gzip trailer check —
        GZipStream accepts a missing one —, a duplicate seq overwrote the earlier one), and on net48 it is the only
        chunked-result check. Now `test/shared/RelayChunkCheck.cs`, linked into both suites, restates the relay's
        `chunk_invalid` rules from design.md: exact header members per seq, every message ≤ maxBytes, seq 0 first, no
        gap / duplicate / more than `count` / chunk after the set was whole, the 32 MiB `count` and 64 MiB `bytes`
        guards, the gzip header, DeflateStream to exactly `bytes`, and the last 8 bytes as CRC32 + ISIZE. The relay
        records each refusal and fails the call with it; the real-socket test asserts none. `RelayChunkCheckTests` (11)
        builds sets with the runtime's GZipStream, not the bridge's splitter. Red first on the real socket: the bridge's
        seq 0 `bytes` made `+ 1` → net48 `RealSocketChunkedTests` red with "inflates to 280609 B, not the 280610 B seq 0
        states"; restored, green.
      - The size comment said ~260 KB of frame: it is 280,609 B (the JSON writer escapes each base64 '+' as `+`, 6 bytes).
      Volt.Relay.Tests 196 → 207, Volt.Ide.Codesys.Tests 507 → 518, Volt.Repo.Gates +1.
      Gate (Release build, every suite in ci.yml's loop, VOLT_REQUIRE_FULL=1): Cli 377, Engine 3222 (+1 skipped),
      Connector 156, Ide.Twincat 728, Ide.Codesys 518 (net48), Contracts 56, Relay 207, Repo.Gates 276 — 0 failed.
      Typecheck, lint (0 errors) and `bun run check` green.
- [x] 5.2 The same test on .NET Framework 4.8 (the CODESYS host's socket stack). x86 as well if a test project
      runs x86 (the TwinCAT worker); otherwise record why not.
      Same file in `Volt.Ide.Codesys.Tests` (505 → 507, all green). .NET Framework 4.8.9363.0 x64: 25 chunks in 12.3 s,
      health 1.0 / 5.5 s (bound 8.0 s), longest silence 0.5 s, byte-identical; control closed at 8.1 s. x86 on net48
      (32-bit CODESYS) runs: `dotnet test test/Volt.Ide.Codesys.Tests --filter FullyQualifiedName~RealSocket --
      RunConfiguration.TargetPlatform=x86` → `.NET Framework 4.8.9363.0 x86`, 25 chunks in 12.4 s, health 1.0 / 5.5 s,
      longest silence 0.5 s; control closed at 8.1 s. No suite runs x86 by default (no test project sets a platform), so
      this x86 run is by hand, not in CI.
      x86 on net10 (the TwinCAT worker, published self-contained `win-x86`) does NOT run here: this machine's x86 dotnet
      (`C:\Program Files (x86)\dotnet`) has Microsoft.NETCore.App 3.1/5.0/8.0 only, and the testhost aborts with
      "framework 10.0.0, arch x86 not found". The worker carries its runtime in its bundle, so no machine needs it;
      covering it would mean installing the x86 .NET 10 runtime on the dev machine and CI.
      Gate review (step 5): that x64 net10 and x86 net48 "bracket" it is an inference, not a measurement — the two
      runtimes' ClientWebSocket and socket buffering differ, which is what this test measures. Tried to install the x86
      Microsoft.NETCore.App 10.0.12 per-user (`dotnet-install.ps1 -Architecture x86 -Runtime dotnet -Version 10.0.12
      -InstallDir %LOCALAPPDATA%\dotnet-x86`, then the run with `DOTNET_ROOT_X86` set): the session's permission system
      refused the install. OPEN for the owner: install it (or allow the install), then run `dotnet test
      test/Volt.Relay.Tests --filter FullyQualifiedName~RealSocket -- RunConfiguration.TargetPlatform=x86` and record
      the numbers here.

## 6. Docs

- [x] 6.1 Move the contract into `packages/volt-cli/docs/relay-protocol.md`, current implementation only: frames
      (binary chunks, announcement, ack, hello field), liveness/window, errors, the bridge log lines, known limits.
      Remove "there is no binary frame" and "Text frames only". Update `docs/logs.html` if it lists relay lines.
      design.md keeps only what is not in the doc.
      Built (step 6, docs only, no code): relay-protocol.md gains `hello.chunks`, a **Chunks** section (the form, the
      ack, bridge → relay: announcement, what is chunked, message size, intake id refusal, window, delivery and stall,
      the relay's receiving rules; relay → bridge: never run from a partial set, the refusal table in the bridge's own
      words, stragglers and reused ids), chunk traffic in Liveness, four end-line causes, BAD_REQUEST cases in Errors,
      the chunked terminal line and the chunk Info/WARN lines in The bridge log, **Known limits**, and a chunked worked
      example; "There is no binary frame" is gone. Every rule and string read from `Volt.Relay` (RelayTunnel,
      RelayFrames, RelayChunks, ChunkWindow, ChunkAssembly, Gzip), so the bridge-side items queued above "for the
      message to PLC Assist before 6.1" are all stated in the doc. `docs/logs.html` lists no relay lines: unchanged.
      design.md keeps only Measured and Decided against. Output-neutral: no source, test or snapshot touched.
      (This note first offered "Volt.Repo.Gates 276/276 (it scans `docs/*.md`)" as verification of the doc. It was
      not: that gate only looks for retired kind spellings. See 6.2 for the gate that now ties the doc to the code.)
      **For the owner:** the message to PLC Assist (items under 2.6, 3.4, 3.5, 3.5b, 4.2) is not something this step
      can send; the doc now carries every one of them and can be that message. `openspec validate
      relay-chunked-results` fails, as before this step: the change has no `specs/` delta and no `skip_specs`.
- [x] 6.2 Review fixes (gate step 6, 2026-10-27). The failing tests came first: Relay 3 red (the new doc gate, the
      id-refusal wording ×2). All 7 findings were right and are fixed:
      - Relay's own trailer check dropped when design.md was trimmed: "The relay, receiving" now says it checks the gzip
        trailer itself (the last 8 bytes = CRC32 of what inflated + ISIZE = `bytes`) and why (Node's
        `DecompressionStream` accepts a second member; .NET's `GZipStream` accepts a missing trailer). CRC32 is added to its
        list of broken sets.
      - The three dropped relay-side details are back in the doc. The idle clock starts at the last request chunk's ack
        "or is sent while that ack is in flight". A bridge whose `hello` has no `chunks` gets whole request frames. The ack
        goes out for a chunk "of an id no longer pending (its set dropped)".
      - "A chunk 0 starts a new request under any id" was false. Now: it starts one under a FINISHED id (reassembled or
        refused). Under an unfinished id it is `arrived twice` and that set is refused (pinned already by Broken's "a
        duplicate seq 0").
      - The bridge log section is fixed. A malformed announcement "changes nothing" (whole-frame before a valid one,
        still chunking after one). New test `A_malformed_announcement_after_a_valid_one_is_a_named_warn_and_the_connection_keeps_chunking`
        pins it (green on arrival: the doc was wrong, the code was not). The two Info lines are described as two lines,
        each true when written: a connection whose announcement follows another frame logs both.
      - Code fix (`RelayTunnel.ServeAsync`): the id refusal named the connection's chunk size (min(relay maxBytes, 16384))
        "the relay's maxBytes". It now reads `the request id (<n> characters) cannot fit a chunk header in the <m> B chunks
        this connection sends, so a large answer could not be delivered; it was not run`. The doc's bullet says the id is
        judged against min(`maxBytes`, 16384). Red first: new
        `The_id_refusal_names_the_chunk_size_this_connection_sends_not_the_relays_larger_maxBytes` (announce 100000,
        id of 16,400 characters → 16384 named) and the existing 1024 test, now asserting the whole message.
      - The refusal table had no " (<why>)" for a reassembled frame the reader cannot read. It now has two rows (another
        kind of frame; an unreadable frame), and Broken has a new case for the second (`[1]` → `… is not a request (not a
        JSON object)`). The `count`/`bytes` row became one template, ``chunk 0 of <id> has no positive integer `<field>` ``.
      - A gate now ties the doc to the code: `RelayProtocolDocTests` (new, Volt.Relay.Tests) reads the refusal table from
        relay-protocol.md (each `<…>` is one value, the rest literal, anchored). It asserts both ways: every refusal the
        bridge gives (all `ChunkedRequestTests.Broken` reasons, plus the connection bound driven by
        `ChunkAssemblyBoundsTests.OverfillConnection`) matches a row, and every row is matched by one. The Broken
        theory now asserts each message and WARN line WHOLE, not by prefix. So a reworded refusal turns its theory row
        red, and a stale doc row turns the gate red. The id-fit test matches its message against the doc's quoted id
        refusal (`RelayProtocolDoc.IdRefusal`). Mutation shown: deleting the "(<why>)" row → gate red, naming
        `the reassembled frame of r1 is not a request (not a JSON object)`. Not gated (local log wording, not wire): the
        WARN block and the end-line cause table of The bridge log.
      Relay 207 → 211 (+2 ChunkedResultTests, +1 Broken case, +1 RelayProtocolDocTests), all green.
      Gate (Release build, every suite in ci.yml's loop, VOLT_REQUIRE_FULL=1): Cli 377, Engine 3222 (+1 skipped),
      Connector 156, Ide.Twincat 728, Ide.Codesys 518 (net48), Contracts 56, Relay 211, Repo.Gates 276. 0 failed.
      Typecheck and lint (0 errors) are green, `bun run check` is green, and volt-cli `bun test test/unit` is 225/225.
      **For the owner (not this change's code):** in the first Cli run, 3 tests timed out:
      `RefsSingleFlightTests` ×2 ("the first refs never reached its walk") and
      `PipeTransportTests.A_request_frame_over_the_size_cap_is_a_BAD_REQUEST_and_the_bridge_keeps_serving` (30 s
      TimeoutException). That run had typecheck, lint and `bun run check` going at the same time. Run again alone, Cli is
      377/377. Volt.Cli.Tests does not reference Volt.Relay, and this step changed no pipe or refs code. A timeout is a
      bug, not a budget, so these pipe tests depending on machine load should be root-caused in their own change.

## 7. Joint gate

- [ ] 7.1 STOP for the owner: once PLC Assist's relay ships reassembly + the announcement, run a joint gate through a
      2 KB/s proxy: a large fetch plus a concurrent health, and a large push request. Then release.

## 8. Close

- [ ] 8.1 Cold full suites (all C# test projects, volt-cli `bun test test/unit`, typecheck, lint, `bun run check`),
      then archive.
