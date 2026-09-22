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

- [ ] **Reproduce it as a failing test.** The assertion is written and was RED when this change was opened; it
      is held here rather than committed red, and goes back into `TcDrawnJumpTests` with the fix:

      ```csharp
      /// The drawn rung drives TWO outputs from the same terminator: the jump destination `owrods`
      /// (Flags = 4) and an ordinary coil `out` (Flags = 0). The pulled text mentions only the jump.
      [Fact]
      public void A_coil_sharing_a_rung_with_a_jump_is_NOT_dropped_on_read()
      {
          var text = PulledText();
          Assert.True(text.Contains("out"),
              "the archive's OutputItems holds `owrods` (the jump) AND the coil `out`; the pulled text " +
              "holds only the jump, so a pull silently drops the coil:\n" + text);
      }
      ```

- [ ] **Pick the destination by its FLAG, not by index.** `NetworkTextWriter.Goto` reads `a.Targets[0]`. The
      jump destination is the target carrying `FlagJump`. With the coil drawn first this renders `JMP out;` —
      a jump to a label that does not exist, which is wrong rather than merely lossy. Cheap, and correct
      independently of how the rest is spelled.
- [ ] **Decide the TEXT FORM for a rung that drives a coil and a jump together**, which is the real work.
      `Assignment` already spells a fan-out (`LET g1 := v;` then one line per target) — but reading that back
      builds a `Demux` plus separate assigns, i.e. a DIFFERENT archive, so it breaks the fixed point that makes
      the round trip safe. Whatever is chosen must read back as ONE `BoxTreeAssign` with two output items.
- [ ] Spell it in `docs/network-text.md` beside the fan-out section, and cover it in `network.test.ts`.
- [ ] **Sweep for the same shape elsewhere.** `Goto` is one place that indexes a target list; find every other
      one that assumes a single target, in both drivers and in the shared writer.

## 2. The map

- [ ] **Member for member, both vendors.** `TcNetworkReader` ↔ `CodesysNetworkReader`, `TcNetworkWriter` ↔
      `CodesysNetworkWriter`, against the ONE shared model (`Volt.Engine/Format/Network`). Output is a table,
      not prose: for every model node and every archive member, what each side reads, writes, and refuses.
- [ ] **Classify every difference as SPELLING / HOST / VENDOR.** Today all three are worded the same way, which
      is how "TwinCAT's importer rejects an unconditional jump" (true) came to stand for "TwinCAT cannot hold
      one" (false — the fixture in task 0 is one).
- [ ] **Re-word every refusal message that blames the vendor for Volt's door.** The user-facing sentence should
      say what Volt cannot do and what the engineer can do instead; it already says the second half ("Create it
      in the IDE and pull it").
- [ ] Fold the result into `DIALECT.md` as a single row per classification rather than four prose rows that
      each re-argue the same distinction.

## 3. Re-cost the four refusals (C20)

- [ ] **The unconditional JMP and RETURN — the candidate, measured in task 0(a).** Implement the swap in
      `WriteNode`: a model `Terminator` arriving where the archive holds a `BoxTreeOperand` replaces that
      element, REUSING its id, and the two target scalars are written as values. Then in order: the offline
      identity gate (already passing), the swap offline against the drawn fixture, the same edit against a live
      XAE, and the build. Only then does `refused-shapes.test.ts` lose those two entries.
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
