## 0. Evidence already in hand (do not re-derive)

- **The regeneration is lossy and the loss is a FIXED POINT.** `original != regenerated` on 9 of 9 recorded
  exports; `regenerated == regenerated-again` on 9 of 9. `splice-graphical-body/body-census.md` §1.
- **`Carry` already solves the unchanged case.** A network whose text did not change keeps its stored XML. The
  no-op short-circuit covers the whole-body case: measured 2026-08-28, 38 elements in, 38 out.
- **The current census of what an EDITED network costs** is `StoredVsPushedTests.KnownLoss` — thirteen fixtures,
  and every entry is a work item for this change.
- **`fbdattributes` is in 7 of 7 recorded FBD exports on BOTH vendors.** Any design that refuses rather than
  carries it refuses essentially every FBD edit. This is why §2 lands before §3.
- **U1 is answered for the corpus:** `executionOrderId` appears in 3 recorded exports, all on `<block>` inside
  **CFC** bodies; zero across 35 recorded FBD/LD bodies. The FBD/LD guard has never fired on real vendor output.
  The marker claiming "zero of 9" was wrong about the number and right about the conclusion.
- **U4 is NOT answered.** What `BoxInputFlagsSupported="true"` controls is still unknown — the
  highest-frequency loss with no known consequence.

### Baseline

Offline **706 / 142 / 80 / 3**. CODESYS e2e **132 / 20 / 0**. TwinCAT e2e **141 / 11 / 0** on a clean
environment. `bun run check` green.

---

## 1. Make the partition explicit — no behaviour change

- [ ] 1.1 **Derive "can network text express this?" from the format**, in one place, as the single source both
      `NetworkTextReader` and `GraphWriter` already implicitly agree on. Not a new hand-list: if the two
      disagree with it, that disagreement is a bug this exposes rather than hides.
- [ ] 1.2 **Census the corpus through it.** For every recorded FBD/LD body, partition the stored elements and
      report expressible / non-expressible counts. This is the number §2 has to preserve and §3 has to verify.
- [ ] 1.3 **No production behaviour changes in this step.** The partition ships dark, with a test, so that §2 and
      §3 are measured against something already known to be right.

## 2. Element-level carry — this is what makes it usable

- [ ] 2.1 **Transplant non-expressible elements from the stored network onto the regenerated one** by `localId`
      correspondence. An element whose anchor the engineer deleted goes with it — legitimately, because the text
      said so. An element whose anchor survived must survive.
- [ ] 2.2 **Re-run `StoredVsPushedTests` and shrink `KnownLoss` empirically.** Every entry that disappears is
      proof; every entry that remains is a case transplantation cannot reach and §3 will refuse. Record BOTH
      numbers — the refusal rate is the cost of this change and it must be visible before the default flips.
- [ ] 2.3 **The LD contact demotion (`splice-graphical-body` §2.1) is the sharpest test.** A contact feeding a
      data pin is lowered to an `InVar` and re-emitted as a floating box, losing the rail wire — a shape change a
      ladder engineer SEES. If transplantation cannot fix this one, the honest outcome is a refusal, not a
      quieter loss.

## 3. Verification on the write path — this is what closes the tail

- [ ] 3.1 **Census stored vs written over the non-expressible partition, in production**, after the splice and
      before the write is accepted. Any difference the text diff cannot account for → refuse, naming the element
      and the network.
- [ ] 3.2 **Delete `SafeToDrop` and `blind`.** Every entry must now be a consequence of the invariant. Any that
      is not is a genuine finding: it means the invariant is weaker than the guard it replaces, and the design
      is wrong rather than the guard being redundant.
- [ ] 3.3 **`KnownLoss` becomes `Assert.Empty`.** The test that recorded approved damage now asserts there is
      none. Keep the fixture list; invert the assertion.
- [ ] 3.4 **The output-less network** (`POU_PBD`) is the case with nothing to transplant, because nothing was
      rendered. It must REFUSE, and its refusal message must say what the engineer should do instead. Rendering
      it as a marker rather than an empty network is the read-side half — the engineer must not be shown an
      empty network where the IDE holds logic.

## 3b. The declaration half — same invariant, much smaller

- [ ] 3b.1 **Carry the declaration's boundary whitespace.** On a push whose declaration changed, reapply the
      STORED declaration's leading and trailing whitespace around the edited content instead of writing the
      trimmed form. The engineer could not have asked to change it — the ST file separates declaration from body
      with a blank line, so the boundaries are not expressible — therefore it must be carried, exactly as a
      non-expressible element is in a graphical body.
- [ ] 3b.2 **Test it as a round-trip through the aspect**, not through the document: a declaration with leading
      blank lines, trailing blank lines, irregular column alignment and a blank line before `END_VAR` must
      survive pull -> edit one variable -> push -> pull, byte for byte outside the edited line.
- [ ] 3b.3 **The unedited case is already correct and must stay correct** — the `Trim()`-vs-`Trim()` guard skips
      the write entirely, so the IDE keeps its own whitespace. Do not "fix" that into an unconditional write.
- [ ] 3b.4 **Accessor declarations are a prerequisite, not part of this change.** They still travel the document
      and REFUSE on TwinCAT. Declarations cannot be called lossless until that path moves to the aspect, which
      needs the `0x800706BE` crash understood first (`declaration-from-the-aspect` §7).

## 4. Live gates — the only ones that count

- [ ] 4.1 **Both vendors' e2e green**, from a verified-clean environment (solution loaded, `--xae-pid` workers,
      pid-suffixed pipes — see `declaration-from-the-aspect/tasks.md` §6 for why this checklist exists).
- [ ] 4.2 **A push that REFUSES must leave the project untouched.** Atomicity is already a rule here
      (`A_refused_push_creates_no_folders`); the new refusal path needs the same proof.
- [ ] 4.3 **Measure the refusal rate on the corpus and state it in the close-out.** "How many real edits does
      this make impossible" is the question a reviewer will ask, and it should not need re-deriving.

## 5. Explicitly NOT in this change

- **Adopting a native transport.** Measured and rejected; see the proposal's Non-goals.
- **Making CFC/SFC/IL editable.**
- **Closing U4** (`BoxInputFlagsSupported`). Under this design it stops mattering for correctness — the element
  is carried whether or not anyone knows what it does — which is itself the argument for the design. Worth
  measuring for its own sake, not as a blocker.

## 6. Close-out must record

- The refusal rate, before and after transplantation.
- Every `KnownLoss` entry that disappeared, and every one that became a refusal.
- Any `SafeToDrop`/`blind` entry that turned out NOT to follow from the invariant — that is the design being
  wrong, and it must be reported as such rather than re-added as a special case.
