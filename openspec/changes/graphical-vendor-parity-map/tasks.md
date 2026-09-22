# Tasks

**Task 1 is the data loss.** Everything else on this list is an investigation; that one is an engineer's coil
missing from their file today.

## 0. The two findings that opened this change — already measured, held as fixtures

- [x] `test/Volt.Ide.Twincat.Tests/fixtures/tc-pou/unconditional-jump.TcPOU` — an unconditional `JMP` DRAWN BY
      HAND in a live TcXaeShell, because `volt push` refuses the shape. Pinned by `TcDrawnJumpTests` (the
      terminator-vs-operand shape, and that the jump survives the read) and added to both identity theories in
      `TcRoundTripTests`.
- [x] The conditional counterpart, created by Volt on the same XAE, diffed against it. **One structural
      difference: the `RValue` element's type.** Recorded in the proposal.

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

- [ ] **The unconditional JMP and RETURN.** Finding 1 says the archive edit is an element swap reusing an
      existing id. Prove it: byte-identity gate first (write the drawn fixture back unchanged — already
      passing), then the swap offline, then the same edit against a live XAE, then the build.
- [ ] **The box output pin.** C20 measured that the importer IGNORES `formalParameter` and wires the variable to
      the box's unnamed RESULT — that is about the IMPORT door. Ask the archive question instead: what does a
      HAND-DRAWN `ET => el` look like, and is the in-place edit an element swap too? Needs a drawn fixture.
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
