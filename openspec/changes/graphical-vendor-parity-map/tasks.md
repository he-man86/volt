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

- [ ] **Run the census when a corpus pull is next possible**, and if the shape occurs, replace the marker with
      the target-operator spelling. The archive predicate is exact: a `BoxTreeAssign` whose `OutputItems` hold
      at least one operand with `Flags & 4` or `Flags & 8` AND at least one without.
- [ ] **Decide the TEXT FORM** — see above. Whatever is chosen must read back as ONE `BoxTreeAssign` with two
      output items, not as two items, or the fixed point that makes the round trip safe is gone.
- [ ] Spell it in `docs/network-text.md` beside the fan-out section, and cover it in `network.test.ts`.
- [ ] **Sweep for the same shape elsewhere.** `Goto` is one place that indexes a target list; find every other
      one that assumes a single target, in both drivers and in the shared writer.

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
      - **The FAN-OUT SHAPE DIVERGES.** TwinCAT folds `LET g := v; o1 := g; o2 := g;` back into ONE
        `BoxTreeAssign` with two `OutputItems` (`Unhoist`); CODESYS has no `Unhoist` and rebuilds it as a
        `BoxTreeDemux` plus N single-target assigns. Both re-render to byte-identical text, so every gate Volt
        has is blind to it — the same pushed text lands two different object graphs. Nothing is lost and it
        compiles; what differs is the shape the engineer sees DRAWN.
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
      - **Deleting a network** is applied on CODESYS and refused on TwinCAT before the per-network loop, so a
        push fails even when every surviving network is a pure value edit. Host gap, tracked below.
- [ ] **Classify every difference as SPELLING / HOST / VENDOR.** Today all three are worded the same way, which
      is how "TwinCAT's importer rejects an unconditional jump" (true) came to stand for "TwinCAT cannot hold
      one" (false — the fixture in task 0 is one).
- [ ] **Re-word every refusal message that blames the vendor for Volt's door.** The user-facing sentence should
      say what Volt cannot do and what the engineer can do instead; it already says the second half ("Create it
      in the IDE and pull it").
- [ ] Fold the result into `DIALECT.md` as a single row per classification rather than four prose rows that
      each re-argue the same distinction.

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
- [ ] **The box output pin — NOT the same shape of fix, measured in task 0(b).** The pin is positional and an
      imported box carries no signature to position it against. Two routes to cost, and the first is cheap:
      (i) can an edit be made against a box the IDE has RESOLVED — i.e. does the signature fill in once the POU
      is opened or built, so the slots exist to write into? (ii) if not, this needs a minted id, which is where
      N12 stops being a reflex and becomes the answer.
- [ ] **The Execute box.** `execute-box.TcPOU` exists and its ST edits in place line for line; the boundary is
      adding a `TextLine`, which needs a minted id (N11). Establish whether an id can be reused here the way the
      terminator swap reuses one — and if not, this is the one that genuinely wants the in-proc host.
- [ ] **Write the verdict for each as a DECISION with its measurement**, then shrink `refused-shapes.test.ts` by
      exactly the ones that moved. The suite failing with "took it, take it off the list" is the intended way
      this change reports progress.

## 4. Close the e2e gap these came through

- [ ] **The coverage counter must count what was never TRIED.** `scripts/e2e-graphical-coverage.ts` counted
      constructs pushed (20 of 25, then 25 of 25) — and every construct it can count is one the writer can
      state, so the shapes Volt cannot create are invisible to it by construction. It needs a second axis: the
      constructs the format can READ, which is the superset.
- [ ] **A hand-drawn fixture for every shape Volt cannot create**, beside `execute-box.TcPOU` and
      `unconditional-jump.TcPOU`. Each one is drawn once, in XAE, and committed — that is the only way these
      bodies enter the repo, and each of the two so far found a bug.
- [ ] **And the conformance recordings that depend on them**: the five fixtures marked `vendorRefuses`
      (`ng_label_jmp_resolved`, `ng_conditional_jump_and_return`, `ng_execute_box`, `ng_box_output_arrow`,
      `cc_vg_undefined_label`). If task 3 makes any of them creatable, the recorder takes them the ordinary way
      and the `vendorRefuses` entry is deleted rather than worked around.
