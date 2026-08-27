# Close-out — what shipped, and what the plan got wrong

Final gate, measured 2026-08-27: offline **691 / 142 / 80 / 3**, live CODESYS e2e **132 pass / 20 skip / 0 fail**,
`bun run lint` 0 errors, `bun run check` green with 4 `[UNMEASURED:]` markers, all enumerable.

Baseline at the start of the change was 646 / 142 / 80 / 3 and 129/20/0.

## What shipped

| | |
|---|---|
| §1 oracle | `StoredVsPushedTests` — stored-vs-regenerated census, as a **ratchet**: the loss set may only shrink, and a baseline entry that stops happening also FAILS |
| §2 defects | `executionOrderId` refused rather than silently zeroed; three false or orphaned comments corrected |
| §3 splice | `NetworkSplice` — a push rewrites only the networks whose text changed |
| §4 gate | `BodySpliceGuard` scoped to the networks actually discarded; `SafeToDrop` split by justification class |
| §5 identity | the measured verdict recorded beside the code it governs, not in this folder |
| §6 docs | `ARCHITECTURE.md` states the new rule; DIALECT B6 retracted, D11/D12 citations repaired |

Plus two things the plan did not ask for and the work produced anyway: the **whole-body no-op** (below), and
`NoStaleNamespaceTests` (in `engine-layout`).

## What the plan got wrong

Recorded because the useful half of a close-out is the predictions that failed.

**1. The biggest win was not in the plan at all.** `NetworkCodec.Encode`'s no-op guard compared the stored element
to the REGENERATED one, and since regeneration is lossy on 9 of 9 exports it could essentially never fire — so
every push rewrote every graphical body. A push restates every member, so editing one line of a declaration
destroyed every diagram in the POU. The fix is one line comparing the pushed text to the baseline render. **18 of
18 red before, green after.** The plan went straight to per-network granularity and would have shipped it on top
of a body-level bug that was doing far more damage.

**2. §2.1 and §2.2 were not writer bugs.** Both were scheduled as defects to fix BEFORE the splice, independently.
Measuring showed both facts are destroyed at READ time: `GraphReader.LowerLadder` lowers a `<contact>` to an
`InVar`, which is `(LocalId, ExecOrder, Expression, Mods)` — nothing records that it was a contact — and comment
boxes are folded into one `GraphNetwork.Comment` string with empty ones dropped. Neither is fixable at that layer
without a text-format change. **They are splice-dependent**, which strengthens §3 rather than weakening it: the
splice is not an optimisation on top of fixed defects, it is the only available fix for most of them.

**3. §4's untouched/edited matrix could not be built on synthetic XML.** The first attempt constructed two FBD
networks holding a `connector` and a multi-source pin; both rendered as EMPTY networks, because hand-written
PLCopen is not the shape the reader accepts. Rebuilt on the recorded Beckhoff export — and the first version of
THAT bailed before calling `Encode` at all, because the last network of that body has no assignment to edit. It
passed identically with and without the change under test. Found by trying to prove it red, which is the only
reason it was found.

**4. `Ops/` (in `engine-layout`) was rejected by the code.** `Volt.Engine.Ops` collides with `Volt.Contracts.Ops`.
Four of that change's planned file assignments were overruled by the compiler; the test for "does this belong
here" turned out to be mechanical — if a file needs a `using` for a layer above it, it is in the wrong folder.

## Still open

- **§2.1, §2.2, §2.4** — splice-dependent, as above. A carried network keeps its contacts, comment boxes and
  network label; a regenerated one still loses them. Closing them properly needs the model to carry what the
  reader currently discards.
- **§3.7's second half** — whether a vendor's importer NORMALIZES what was carried. The first half is measured
  (a part-vendor, part-Volt document imports, compiles and is a fixed point on live CODESYS). The wire serves
  network TEXT, not XML, so a normalization that preserved the text while rewriting ids would look identical from
  e2e — **this change's own blind spot, one layer out**. Needs the exported document. TwinCAT entirely unmeasured.
- **Four `[UNMEASURED:]` markers**, all carried in the code they bear on rather than left here: U1
  (`executionOrderId` — does either vendor emit it?), U4 (`BoxInputFlagsSupported`), U6 (the normalization above),
  and the `DISABLED` network flag. **Three of the four close on one sitting at the two IDEs**: build an FBD
  network with two coils on one variable and reorder them; disable a network; export both.
