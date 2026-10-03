## 0. Design gate — do this first

- [x] 0.1 Check every item below against volt's design (CLI/workspace push model, pre-flight vs apply, the no-rollback
      rule in PushService.Reject, related docs and open changes). Record per item: FITS, or CONFLICTS + why + the
      volt-native alternative. Implement only the FITS items; stop and leave the rest for the owner.
      **Done 2026-10-03 — full reasoning, measurements and the volt-native alternatives in `design.md` "Step 0".**
      Re-verified on the tree at `bc408ceccf`: the cited oracles exist and pin all-or-nothing before the first write
      (`PushServiceTests.A_batch_refused_on_a_LATER_op_writes_NONE_of_the_earlier_ones`,
      `UnopenedItemTests.Without_force_an_op_on_it_refuses_the_whole_push_before_an_earlier_op_is_written`,
      `CreateRollbackTests` "An UPDATE is deliberately not rolled back",
      `DeclarationBeforeMembersTests.A_create_whose_text_refuses_its_member_is_refused_by_name_and_leaves_nothing`,
      e2e `endpoints/push.test.ts:126`, `graphical/preflight.test.ts:51`); `docs/index.html:93` "A push that cannot
      land in full lands nothing"; the CLI-instruction NOTE is `PushService.cs:192`.
      Measured (FakeIde, design.md table): apply-time refusal of a create → `accepted:false`, prose "2 of 3", refs
      after = the 2 earlier items, NO receipt, the refused create already rolled back (no shell since `f7eb383f47`);
      pre-flight with 2 INVALID_ST items in 4 → only the FIRST is named (2 round trips).

      | # | item | verdict |
      |---|---|---|
      | 1a | pre-flight refusal per item, rest applied | CONFLICTS — "lands nothing" rule + 4 oracles; items reference each other (TYPE refs no op check sees). Alt: collect EVERY pre-flight refusal, still write nothing |
      | 1b | gate refusal per item (STALE_ITEM_VERSION, ITEM_EXISTS, ITEM_MISSING, ITEM_UNVERIFIED) | CONFLICTS — same rule, e2e push.test.ts. Gate already collects all; nothing to build |
      | 1c | apply continues past an IDE refusal | CONFLICTS — moves the project further from both baseline and HEAD. Alt: stop, name every op not reached (`NOT_ATTEMPTED`) |
      | 2a | refused create leaves nothing | FITS — already built (`f7eb383f47`); gap: a failed rollback delete is only a log line → the conflict must say the shell remains |
      | 2b | refused update restores previous text | CONFLICTS — `CreateRollbackTests`; member re-create is a new object. Alt: report it touched (MemberRefusal text), CLI keeps its OLD baseline so the next pull brings the real state |
      | 3 | something landed → `accepted:true` + conflicts + receipt; nothing → `accepted:false` | FITS — `accepted:false` ⇔ no op applied in full; the refused op's own partial effect is in its reason, as the `MemberRefusal` oracles pin (option A; gate R1) |
      | 4 | op depending on a refused op refused with it | FITS — already true (one op per item + gate simulation + stop-at-refusal); nothing to build |
      | 5 | client-neutral reasons | FITS for every apply-time reason — the NOTE and the unpinned "Pull first" / "--force" raised in the apply loop (gate R2); CONFLICTS for the pre-write remedies pinned by oracles (`StReader` "Run `volt pull`" ×7 in tests, `PushConflicts` "--force") — owner |
      | 6 | `Log` member-name refusal in pre-flight | FITS only if measured live (3.1) |

      **Left for the owner (not built):** 1a/1b per-item application (possible opt-in mode, git `--atomic` analogy),
      1c, 2b, re-phrasing the pinned CLI remedies (5). The tasks below are re-scoped to the FITS items, and
      `specs/bridge-push/spec.md` is rewritten to state the chosen design (the proposal-time delta asserted 1a/1c/2b).

- [x] 0.2 Gate step 0 — review findings on the step-0 artifacts (2026-10-03). All seven verified against the tree and
      fixed IN THE ARTIFACTS (no code is touched by step 0, so no test goes red; each fix names the test its later task
      writes red first):
      R1 (2.4 vs the `MemberRefusal` oracles) — valid: default chosen that keeps the oracles, `accepted:true` ⇔ an op
      applied IN FULL; the flip is left for the owner (2.4, design 3, spec). R2 (apply-time "Pull first") — valid:
      2.5 covers every apply-loop reason (unpinned). R3 (CLI adoption) — valid: known ∪ applied − conflicted (2.4b).
      R4 (partly landed op and the next push) — valid: the spec scenario states it, 2.4b tests it. R5 (requirement 1
      overpromised) — valid: gate per-item ∪ pre-flight built in 2.1; lease and request-shape `BAD_REQUEST` stated as
      the exceptions. R6 (2.4 without 2.4b) — valid: one commit, CLI test first. R7 (proposal) — valid: proposal
      marked, pointing to design "Step 0".
      Suites on this tree (docs-only step, no code touched; `openspec validate` valid; volt-cli `tsc` clean):
      Engine 1870 pass / 1 skip, Cli 239, Contracts 19, Connector 113, Ide.Twincat 288, Ide.Codesys 202, Relay 46,
      Repo.Gates 92 — 2869 pass, 0 fail; `bun test test/unit` 4/4. (`dotnet build Volt.sln` reported 10 MSB3021/3027
      copy errors only: `src/Volt.Ide.Twincat/bin` is locked by a running `VoltBridgeTwincat` this step did not start
      and did not stop; every test project built.) The LSP suite is not this change's (no LSP file changes).

## 1. Test red

- [ ] 1.1 Live fixture (CODESYS): push `[create A.<dut kind>, create FB.pou with METHOD Log]`. Today (re-measure —
      the shell is expected GONE since `f7eb383f47`): `accepted:false`, prose "1 of 2 … Run `volt pull`", no receipt.
- [ ] 1.2 Pre-flight: a batch with TWO INVALID_ST items and two valid items. Today: only the first bad item is named,
      nothing written.

## 2. Per-item outcome

- [ ] 2.1 Pre-flight collects EVERY refusal (one conflict per refused op, code + reason + line) and still writes
      nothing (`accepted:false`). (Design 1a — per-item application CONFLICTS, owner.) The gate's PER-ITEM conflicts
      (`STALE_ITEM_VERSION`, `ITEM_EXISTS`, `ITEM_MISSING`, `ITEM_UNVERIFIED`, `UNREADABLE`) no longer return before
      the pre-flight: the pre-flight runs over the ops the gate did not name and the response is the UNION (review
      R5: `[stale A, malformed B]` names both). Unchanged, and stated in the spec: `STALE_PROJECT_VERSION` (the lease —
      the client must pull before anything else means something) is answered alone, and `BAD_REQUEST` for the
      request's own shape (`RequireWireNames` / `RequireOneOpPerItem` — a client bug, not an item's content) stops at
      the first offending op. Test red first: `[set A stale ifVersion, set B INVALID_ST]` → two conflicts.
- [ ] 2.2 Apply loop: on an IDE refusal STOP (no rollback of earlier ops; a refused create stays rolled back, 2a);
      if the rollback's own delete fails, the conflict says the shell remains. (Design 1c/2b — continuing / restoring
      an update CONFLICTS, owner.)
- [ ] 2.3 Dependent ops — already true (one op per item, gate forward simulation, stop-at-refusal makes every later op
      `NOT_ATTEMPTED`); nothing to build (design item 4).
- [ ] 2.4 Response: at least one op APPLIED IN FULL → `accepted:true` + receipt + conflicts = the refused op (its
      code) + `NOT_ATTEMPTED` for each op after it; no op applied in full → `accepted:false` as today, no NOTE —
      whatever of the refused op itself was touched (an update's declaration / deleted member, a create whose
      rollback failed) is stated in ITS conflict's reason, not in `accepted` (review R1: the `MemberRefusal` oracles
      `DeclarationBeforeMembersTests.An_update_whose_new_text_refuses_its_new_member_says_the_declaration_landed` and
      `An_update_that_drops_a_member_and_is_refused_a_new_one_says_the_drop_landed` assert `Accepted == false` for
      exactly that single-op shape and stay unchanged; flipping them to `accepted:true` is a premise change left for
      the owner — design "Step 0 / 3"). `ConflictCodes.NotAttempted` in Volt.Contracts; PushResponse doc,
      docs/wire.html, logs.html, index.html.
      **2.4 and 2.4b land in ONE commit, the CLI test red first** (review R6): `Commands.Push` today reads conflicts
      only when `!resp.Accepted` and on `accepted` points `volt/ide` at HEAD and adopts the receipt for every known
      and pushed name, so 2.4 alone would mark refused and `NOT_ATTEMPTED` edits as synced (`volt status` shows a
      refused `F.pou` in sync while the IDE has no `F`).
- [ ] 2.4b CLI (`Commands.Push`): on accepted-with-conflicts, `volt/ide` = previous tree + the APPLIED ops' rows only;
      adopt receipt versions for (names the sidecar already knows ∪ names the APPLIED ops produce) MINUS every
      conflicted name — not "applied names only" (review R3: a native rename rewrites referencing items outside the
      op set, and their new versions must enter the baseline as they do today, Commands.cs "THE BASELINE GROWS ONLY
      BY WHAT THIS CLIENT PUSHED"); `retiredByPush` from applied ops only; conflicted names keep their old sidecar
      entry; print conflicts with the CLI's own advice by code. Test: `[rename X→Y (lands), update Z (refused)]`
      with W referencing X → W adopts its post-rename receipt version, Z keeps its old one.
      A conflicted op that PARTLY landed (an update whose declaration / deleted member landed; a create whose
      rollback failed) keeps its old baseline on purpose, so the next `volt push` is refused (`STALE_ITEM_VERSION` /
      `ITEM_EXISTS`) and `volt pull` must bring the IDE's state in first (review R4) — the CLI's advice for that
      conflict says pull first; test it (partial push, then push again → refused, pull → push re-sends the edit).
- [ ] 2.5 Delete the apply NOTE (`volt pull` … push again) from `PushService.Reject`, AND the CLI advice in every
      other reason that can reach a conflict on an ACCEPTED push, i.e. raised inside the apply loop (review R2 —
      no test pins these; `grep -rn "Pull first\|change it in the IDE" packages/volt-cli/test` finds nothing):
      `RequireUnchanged` / `RequireUnchangedBeforeDelete` ("Pull first, then push again.", PushService.cs:444/:468),
      `BodyFormatGuard.RequireWritable` ("Pull first, or change it in the IDE.", BodyFormatGuard.cs:128/:144 —
      "change it in the IDE" may stay, it is not a client command), and the TwinCAT `ExplorerSnapshot.Reason`
      ("Push the fixed text with --force", TcSolutionExplorer.cs:136) where an apply-time read on a `--force` push
      can raise it. Test: an accepted partial push whose refused op is a race (`[create A, update B]`, B edited in
      the IDE after the gate) → its reason contains none of `volt pull`, `Pull first`, `--force`, `push again`.
      The remedies raised only BEFORE the first write (`StReader` "Run `volt pull`", pinned ×7; `PushConflicts`
      "--force") are on `accepted:false` answers, outside the requirement, and stay (design item 5, owner).

## 3. Optional pre-flight

- [ ] 3.1 If a live IDE shows a member-name refusal is decidable from the text (e.g. `Log`), add it to pre-flight with
      the measurement recorded; otherwise leave it to 2.2.

## 4. Verify

- [ ] 4.1 1.1 now: `accepted:true`, the DUT in the receipt, `FB.pou` the only conflict, no shell, `refs` matches the
      receipt. 1.2 now: both bad items named, nothing written.
- [ ] 4.2 CLI push of a partially refused batch updates the baseline for applied items (and the receipt's
      rewritten known items) only; full suites green.
