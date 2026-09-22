# Tasks

**Task 1 is the data loss.** Everything else on this list is an investigation; that one is an engineer's coil
missing from their file today.

## 0. What the hand-drawn fixtures measured — done

- [x] `test/Volt.Ide.Twincat.Tests/fixtures/tc-pou/drawn-refused-shapes.TcPOU` — THREE of the four refused
      shapes, DRAWN BY HAND in a live TcXaeShell because `volt push` refuses every one of them: an unconditional
      `JMP`, a box output pin wired straight to a variable (`TON_0(IN := in, PT := , ET => timeet)`), and an
      unconditional `RETURN` — beside an undriven coil and an unconnected input pin. Volt READS all of them, and
      the body passes both identity theories in `TcRoundTripTests`: a no-op push writes nothing back.
- [x] The counterparts Volt CAN create, made on the same XAE and diffed against it, shape by shape. The three
      measurements below are the ones that re-cost section 3, and they do not all point the same way.

      **(a) JMP and RETURN are the same fix, and it is small.** Against the conditional form the differences are
      the `RValue` element's TYPE and two scalars on the placeholder operand:

      ```
      CONDITIONAL (Volt made it)            UNCONDITIONAL (drawn)
        RValue t="BoxTreeOperand"             RValue t="BoxTreeTerminator"
          Operand "cond"  Id 4                  <n n="Input" />          <- nothing drives it
          Id 3                                  Flags 0, Id 32
        target: Fixed=true  LValue=false      target: Fixed=false LValue=true
      ```

      `WriteJump` already writes the control-flow bit in place, on the item AND the destination operand, and
      both scalars are ordinary value writes the writer does today. What refuses the edit is ONE line —
      `WriteNode`'s default arm, "a 'BoxTreeOperand' item becomes a terminator". The swap needs **no invented
      id** (N11's wall): it reuses the id of the element it replaces. Ids need not be contiguous — the drawn
      body skips 9, 12, 13, 28-31.

      **(b) THE OUTPUT PIN IS NOT THE SAME KIND OF PROBLEM, and this is the measurement that says so.** The pin
      is POSITIONAL — the drawn box's `OutputItems` holds `<n />` at slot 0 (the unwired `Q`) and the operand
      `timeet` at slot 1 (`ET`), index-aligned with `OutputParam.Names = [Q, ET]`. A box VOLT created through
      `PlcOpenImport` has neither: ONE blank slot, and `OutputParam.Names = [Out1]` with an EMPTY type. So an
      in-place edit cannot even find the ET index, because the imported box does not carry the signature that
      defines it. This needs a resolved box and a NEW element with a minted id — not an element swap — which is
      the first of the four where the in-proc host (N12) is a real candidate rather than a reflex.

      **(c) An imported box's OutputParam is UNRESOLVED, and it builds anyway.** `Out1` with no type, where the
      IDE's own editor writes `[Q, ET] / [BOOL, TIME]`; `EN`/`ENO` are explicit nulls where the drawn box has
      `false` scalars. The project compiles with ZERO errors, so the compiler derives the signature
      independently of what the archive says — which is why this has never been visible. Not a bug to chase on
      its own; it is the reason (b) is hard, and it belongs in the map as a HOST difference.

## 1. THE COIL A PULL DROPS

- [x] **The destination is picked by its FLAG, not by index — DONE 2026-09-22.** `NetworkTextWriter.Goto` read
      `a.Targets[0]`. The jump bit lives on the TARGET OPERAND as well as on the item (C13), so "which target
      is the label" has a real answer. In the drawn body the jump happens to be first, so the symptom was only
      a dropped coil; with the coil first the same code renders `JMP out;` — a jump to a label that does not
      exist. `JumpDestinationTests` covers both orders and was verified red with the selection put back.
- [x] **And the dropped coil is now NAMED rather than silent — DONE 2026-09-22, as a marker.** An `Assign`
      whose targets MIX control flow with ordinary coils has no text form, and `NetworkTextWriter.Unspellable`
      says so: `LD (a rung driving a coil and a jump together)`. Both drivers already call it, so it lands on
      both vendors identically.

      **Why a marker and not a spelling.** A spelling that round-trips is perfectly possible — a target
      operator beside `S=`/`R=` — and it is NOT being guessed at, because the question it turns on is whether
      the shape occurs in real projects, and that is answerable only from ARCHIVES. The corpora on disk are
      pulled TEXT, written by the very code that dropped the coil, so they cannot show it. `UnspellableCoilTests`
      is the precedent in both directions: the coil-modifier census found ZERO in five real projects, which is
      what made a marker acceptable there, and Lenze's single lone `RETURN` target is why the guard here is
      narrow — a lone jump, a lone return and an ordinary fan-out all still materialize.

- [x] **THE CENSUS RAN — 2026-09-22, four real customer projects, and the answer is ZERO.** Not one rung in
      Lenze, Pro2193, V71_PackML or AWA_Palletizer drives a coil and a jump together
      (`scripts/probe-nwl-assign-outputs.py`). So the MARKER stays and no text form is built for it: that is the
      standard `UnspellableCoilTests` set — census first, and a marker is the right answer for a shape that does
      not occur. It also settles the question the run was for: the marker turns NO real body into a marker.
- [x] **Decide the TEXT FORM — decided: none, for THIS shape.** See above. (The fan-out shape, measured in the
      same run, went the other way — 40 occurrences — and its spelling is section 2's open decision.)
- [x] **Swept — and it found one, which is the argument for sweeping. DONE 2026-09-22.** Three places index a
      target or output list; two are guarded by a count check and correct. The third was `EnabledAssign`, whose
      own multi-target arm minted `g` — so an EN-gated box feeding two coils rebuilt as a `Demux` plus two
      assigns, the identical shape change to the plain case, in the sibling method. Found by looking rather than
      by hitting it, and covered by `An_enabled_box_driving_several_coils_reads_back_as_ONE_item`.

## 2. The map

- [x] **Member for member, both vendors — DONE 2026-09-22**, by a 10-agent differential pass over five
      dimensions (assignments/coils, control flow, boxes, networks/structure, refusals), each mapped and then
      ADVERSARIALLY VERIFIED by a second agent whose job was to refute it against the cited lines. Every finding
      had to cite file:line on BOTH sides and name the test that would catch it.

      **9 confirmed bugs, 9 host gaps, 1 spelling, 2 refuted — and 18 of the 19 survivors had NO test.**

      THE THREE THAT WERE DATA LOSS ARE FIXED (commits below this change):
      - CODESYS lost whole POUs where TwinCAT showed a marker. Four reader refusals threw a bare
        `NotSupportedException`, which escapes to `Versioning.SafeVersion` → Unreadable → `FetchService` drops
        the item from `changed`, `items` AND `folders`. `UnrepresentableBodyException` carries the marker now,
        both drivers catch it, and a repo gate forbids the bare throw in a network reader.
      - CODESYS had NO push pre-flight at all, so every refusal inside its writer fired mid-write and a create
        wrote items 1..N-1 before failing. Proven live, then fixed by an override that runs the SAME
        `ResolveBoxType` the write does.
      - A rung driving a coil AND a jump dropped the coil (fixed as a marker, task 1).

      STILL OPEN, in the order the evidence ranks them:
      - **THE FAN-OUT DIVERGENCE — CLOSED 2026-09-22.** `m<n>` is spelled, both shapes round-trip as themselves, and `Unhoist`'s guess is deleted. The investigation that got there, kept because its shape is the lesson: **it is not a driver bug — it is a FORMAT gap, and both drivers guessed, in opposite
        directions.** Reported as a bug (TwinCAT folds to one multi-output `BoxTreeAssign`, CODESYS builds a
        `BoxTreeDemux` plus N assigns). Probed offline 2026-09-22, and the question underneath it has a worse
        answer than the finding: **network text cannot tell the two shapes apart at all.**

        ```csharp
        // BOTH of these fail today.
        Assert.True(Write(MultiOutputAssign()) != Write(DemuxAndTwoAssigns()));   // same text
        Assert.Equal(2, ReadBack(Write(MultiOutputAssign())).Targets.Count);      // comes back a Demux
        ```

        `Assignment` renders an N-target assign as `LET g1 := v; o1 := g1; o2 := g1;`, a `Demux` renders as the
        same thing, and the reader turns any `g<n>` LET into a Demux — by the PREFIX, not the use count. So a
        multi-output assign cannot survive a round trip on EITHER vendor, and `Unhoist` is not a feature TwinCAT
        has and CODESYS lacks: it is a REPAIR that guesses the assign shape, and it must therefore flatten a
        real editor-drawn Demux the same way CODESYS inflates a real multi-output assign. The mirror bug.

        **What is NOT being done, and why.** The fix is a text distinction, and the obvious one — `out1, out2 :=
        v;` — REGRESSES what the `LET` form exists for: each target keeps its OWN operator, so a fan-out whose
        coils disagree (`out1 :=`, `out2 S=`) has no comma spelling. The distinction that does work is a second
        name family beside `g*`/`i*`/`en*` — say `m<n>` for "one item, several targets" — which is small,
        unambiguous and preserves the operators.

        **IT WAS THEN CENSUSED AND BUILT.** The standard `UnspellableCoilTests` set — census the shape in real
        projects BEFORE spelling it — was met: 40 occurrences in Lenze, so the spelling is justified and `m<n>`
        is what shipped. `Unhoist` lost its reshaping job in the same change and kept only the one that does not
        depend on the distinction (counting independent rungs for D25) — and removing the reshape was not
        optional: with the text saying which shape it is, folding REFUSES a real fan-out, one model tree against
        three archive items, the mirror of the bug it was added to fix.

        That regression was invisible to both identity theories, because they push an UNCHANGED body and
        `Unchanged` short-circuits per network before the item count is compared. Only an EDIT reaches it, which
        is why `An_edit_to_a_network_holding_a_real_fan_out_wire_is_not_refused` exists beside the fixture rows.

        Superseded reasoning, from before the projects were found: It needs ARCHIVES (the predicate is a `BoxTreeAssign` with more than one entry in
        `OutputItems`), and the corpora on disk are pulled TEXT written by the very code that cannot express the
        distinction. It also changes the canonical form, so every already-pulled workspace holding a fan-out
        shows a diff on the next pull — a cost worth paying for a shape that occurs, and not for one that does
        not. Same blocker as the mixed-rung census in task 1, and the same probe closes both.
      - **A RETURN's bit never reaches the destination operand on EITHER vendor**, and it cannot be fixed at the
        writer: `NetworkTextReader` parses `RETURN;` to an `Assign` with ZERO targets, so there is no target to
        write it to. C13 records the vendor putting it there (live SP21 `ATD_FQI`, `out[0] = '???' flags=Return`).
        The fix is in the FORMAT, not the drivers — the same place task 1's coil lives.
      - **`CallType` is read wrongly on BOTH vendors, and the map understated it.** TwinCAT reads any non-null
        `CallType` as `Operator`; CODESYS excludes only `"None"`. But the drawn archive holds
        `<v n="CallType" t="Operator">FunctionBlock</v>` — the `t=` is the ENUM TYPE's name and the value is the
        member — so a TON call reads as an OPERATOR on both. Latent today (nothing consumes an archive-derived
        `Kind`), and NOT fixed here because the correct rule needs one measurement this repo does not have: what
        CODESYS's LIVE `CallType` stringifies to for a function-block call. Guessing which value space the two
        share is precisely the mistake N11 exists to warn about. The probe is a `runscript` read of a live FB
        box's `CallType`.
      - **Deleting a network** is applied on CODESYS and refused on TwinCAT — and the refusal gave the WRONG
        REASON, which is the half that was fixed. The generic message says Volt never builds archive elements;
        a deletion builds nothing, so it explained the refusal by pointing at the wrong thing.

        The real reason is AMBIGUITY, and it is not a small obstacle: networks pair by POSITION, and network
        text renumbers its headers on every pull — so `NETWORK 0, 1, 2` after deleting the second of four is
        BYTE-IDENTICAL to the same text after deleting the fourth. The push does not carry which network went,
        and removing the wrong one deletes working logic. CODESYS never faces it because its writer rebuilds
        every changed network from the model, so deletion falls out for free.

        The message now says which case it is and why; `Deleting_a_network_is_refused_for_the_AMBIGUITY_not_the_member_contract`
        pins it. Closing the gap properly means matching the survivors by CONTENT rather than by position —
        still open, and now stated as a design rather than as a mystery.

      **THE CENSUS IS DONE — 2026-09-22, four REAL CUSTOMER PROJECTS through a live CODESYS**
      (`scripts/probe-nwl-assign-outputs.py`, log committed beside it). It was blocked on "the corpora on disk
      are pulled text"; the original `.project` files were on this machine all along. Lenze alone: 373 networks,
      479 `BoxTreeAssign`, 8,133 tree nodes walked.

      **IT ANSWERS THE TWO QUESTIONS IN OPPOSITE DIRECTIONS, which is the useful outcome:**

      - **THE MIXED RUNG: ZERO.** Not one rung anywhere in four projects drives a coil and a jump together. So
        the MARKER is the right answer and stays — exactly the standard `UnspellableCoilTests` set (census
        first; a marker is acceptable for a shape that does not occur). It also answers the question that
        prompted the run: the marker introduced in task 1 turns NO real body into a marker.
      - **THE MULTI-OUTPUT ASSIGN: FORTY**, all of them in Lenze, all "all coils", one with **20 targets**
        (`TrayFiller`). Beside 573 `BoxTreeDemux`, so both shapes are ordinary in the same project. The format
        cannot tell them apart, so every one of those 40 rungs round-trips into a `Demux` — 21 items where the
        engineer drew 1, on CODESYS. **No data is lost** (all 20 targets survive the text, each keeping its own
        operator) and it compiles identically; what changes is the shape they see drawn. That is enough to
        justify the `m<n>` spelling, which is therefore no longer blocked on evidence — only on the decision to
        change the canonical form, which diffs every already-pulled workspace holding a fan-out.

        And it makes `Unhoist` DELETABLE rather than merely unnecessary: it exists to guess the assign shape
        back, and with the text saying which shape it is, TwinCAT stops guessing — a repair removed because the
        format learned to say the thing.
      - **SPLIT POINTS: ZERO** across all four, confirming C12 and making the one-sided TwinCAT reader (which
        does not look for them at all) a very low-risk gap.

      Superseded first data point, kept for the record: (2026-09-22, every archive
      on disk — 25 distinct `.TcPOU`, 15 `BoxTreeAssign` items): **3 multi-output assigns** and **1 multi-target
      rung carrying control flow**. A weak sample and fixtures rather than customer projects, so it settles
      nothing about FREQUENCY — but it does settle that both shapes are real IDE output rather than theoretical,
      which is more than was known. The census that decides the format questions still wants customer archives;
      the predicates are exact and are recorded above.
- [x] **Classified — DIALECT C25, DONE 2026-09-22.** SPELLING (same behaviour, different mechanics — in-proc
      live objects vs an out-of-process archive; EN/ENO is the clean example and is not a gap), HOST (one
      vendor's ACCESS PATH cannot do it — the big class, and it has ONE cause: `PlcOpenImport` is TwinCAT's only
      door), VENDOR (a real IDE difference with a measurement). Rarer than it looked: three of the four shapes
      C20 opened with were HOST, and two of those are now created.
- [x] **Re-worded, and there was less to do than expected — DONE 2026-09-22.** `TcPlcOpenWriter.Refuse` and
      `TcNetworkWriter.Refuse` already said "which Volt cannot express as PLCopen" / "which Volt cannot do
      through the archive", which is HOST-correct. The one that blamed the vendor was the OUTPUT PIN, reworded
      with the second measurement; the two that blamed it loudest — the unconditional jump and return — are
      gone, because the shapes are created now. Swept the drivers for "rejects" / "cannot hold" / "does not
      support" in live messages: none left. The RULE is what C25 carries, so the next one gets caught.
- [x] Folded into `DIALECT.md` as **C25**, one row carrying the three classes and the rule about MESSAGES that
      follows from them — instead of four prose rows each re-arguing the distinction.

## 3. Re-cost the four refusals (C20)

- [x] **The unconditional JMP and RETURN — DONE 2026-09-22, and they are CREATED now, not merely editable.**
      `TcNetworkWriter.SwapToTerminator` replaces an item with an unconnected terminator in place, reusing the
      id of the element it replaces and declaring `BoxTreeTerminator` in the archive's `TypeList`. Two things
      then fell out in order:
      - **The EDIT works directly** — a conditional jump edited into an unconditional one never reaches the
        importer at all, because only the RValue element changes.
      - **And so does the CREATE**, by the route the create path was already built on: `TcPlcOpenWriter` wires
        the jump or return to an EMPTY `<inVariable>` (the importer's own spelling for an unwired pin, already
        measured), the importer builds it, and `Stamp` swaps that operand for the terminator. The placeholder's
        operand is discarded by the swap.

      Verified live on TcXaeShell 15.0: created, pulled back BYTE-IDENTICAL, project builds with ZERO errors,
      and the pulled text re-pushes to itself. `refused-shapes.test.ts` FAILED with "took it, take it off the
      list" — which is the intended way this reports — and both entries are now `refusedBy: []`.

      **The two scalars from task 0(a) were not load-bearing.** The drawn body has `Fixed=false LValue=true` on
      the destination operand where Volt writes `Fixed=true LValue=false`, and the IDE built it either way.
      Measured rather than copied, which is the only reason they are not in the code.
- [x] **The box output pin — COSTED, and the verdict is the in-proc host. DECIDED 2026-09-22.**
      - The pin is POSITIONAL: a drawn box holds `<n />` at slot 0 (unwired `Q`) and the operand at slot 1,
        index-aligned with `OutputParam.Names = [Q, ET]`. A box VOLT imported has ONE blank slot and
        `Names = [Out1]` with no type, so an in-place edit cannot even find the ET index.
      - Route (i) MEASURED AND CLOSED: the signature does NOT fill in. `VltDrawCompare.TcPOU` still reads
        `Out1` after a full build — and the project compiles with zero errors, because the compiler derives the
        signature independently of what the archive says. That is also why none of this was ever visible.
      - Route (ii) is a minted id, so N12 it is. **And the document route is closed on its own evidence**: both
        spellings have now been put to a live XAE. `formalParameter="ET"` on an `<outVariable>` is ignored
        (2026-09-06), and DECLARING the real pins in `<outputVariables>` and wiring to one of them — TC6 exactly
        as written — is ALSO lowered to a separate `BoxTreeAssign` (2026-09-22). There is no third spelling.
- [x] **The Execute box — COSTED, and it is the one that genuinely wants the in-proc host. DECIDED 2026-09-22.**
      The terminator swap gets away with no invented id because it REPLACES an element and reuses that element's
      id. An Execute box has nothing to replace: PLCopen has no element for ST-in-FBD at all, so a create has
      nothing to import, and the in-place route ends at adding a `TextLine`, which is a NEW element with no
      predecessor whose id it could take. That is the distinction — reuse is free, minting is N11 — and it is
      why this one does not follow the jump and return out of C20.
- [x] **The verdicts are written and the ratchet shrank — DONE.** Of the four shapes C20 opened with, TWO are
      created now (`refusedBy: []` for the unconditional JMP and RETURN, taken off the list the way the suite
      demands: it FAILED with "took it, take it off the list" and that is what prompted the edit). The other two
      are decided above, both on the in-proc host, both with the document routes closed on measurement rather
      than on caution.

      A FIFTH shape joined C20 in the same pass and it is the one nothing could see: a fan-out WIRE pushed at
      TwinCAT comes back as a multi-output ASSIGNMENT, because the importer's lowering collapses it. D22 had
      recorded exactly that and read it as a success — network text spelled both shapes the same way, so no
      assertion could tell. `m<n>` distinguishes them now and `fanout.test.ts` holds the divergence live.

## 4. Close the e2e gap these came through

- [x] **The second axis is in — DONE 2026-09-22, and two attempts at it were wrong first.** Counting "pushed"
      says nothing about an uncreatable shape, because `refused-shapes.test.ts` pushes every one of them and the
      push IS the assertion that it is refused. Counting "pushed outside a refusal test" says nothing either —
      and excluding `uncovered-shapes.test.ts` along with it reported five WORKING constructs as refused, which
      is precisely the mistake the axis exists to prevent.

      What is knowable statically is narrower and useful: for a shape no driver can build, the only thing that
      can hold one is a HAND-DRAWN archive, so the report scans `fixtures/tc-pou/*.TcPOU` and says which
      uncreatable shapes have one and which need somebody in XAE.
- [x] **Every shape Volt cannot create HAS one — verified by the report above, DONE 2026-09-22.** The list
      shrank from both ends: the unconditional JMP and RETURN left it by becoming creatable, and the two that
      remain are held — the output pin by `drawn-refused-shapes.TcPOU` (and `EnoSlot.derived.TcPOU`), the
      Execute box by `execute-box.TcPOU` (and `ExecuteBox.derived.TcPOU`). Both arrived this way and both found
      a bug in the hour they arrived, which is the case for drawing the next one rather than a closed chapter.
- [x] **THREE OF THE FIVE ARE RECORDED — 2026-09-22, and exactly the way this task said they would be.** It
      read "if task 3 makes any of them creatable, the recorder takes them the ordinary way and the
      `vendorRefuses` entry is deleted rather than worked around". Task 3 made the unconditional JMP and RETURN
      creatable, and the recorder took all three without a single change to it:

      ```
      ng_label_jmp_resolved            buildSuccess: true,  no diagnostics
      ng_conditional_jump_and_return   buildSuccess: true,  no diagnostics
      cc_vg_undefined_label            buildSuccess: false, "No such label 'MISSING' within the scope of the JMP statement."
      ```

      **The third is the one that proves the point.** It exists to make the compiler say that sentence, and
      nobody could hear it on TwinCAT while the body could not be created — a fixture whose whole purpose was
      unreachable, counted as "no ground truth to have". Their `vendorRefuses` markers are deleted; conformance
      is 4157 pass / 0 fail.

- [ ] **The last two need a HUMAN IN XAE**: `ng_execute_box` and `ng_box_output_arrow`. Both are decided in
      section 3 — the in-proc host (N12) — so no amount of driver work reaches them, and a push test for a body
      the pusher cannot build is not writable. Somebody draws the two fixture bodies in XAE, pulls them, and the
      recorder runs the ordinary way, exactly as it just did for the three above. That is the only open item in
      this change, and it is the one thing in it that is not code.
