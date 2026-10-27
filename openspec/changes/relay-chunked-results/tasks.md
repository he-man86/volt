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
