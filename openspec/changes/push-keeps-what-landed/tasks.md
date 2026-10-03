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

- [x] 1.1 Live fixture (CODESYS): push `[create A.<dut kind>, create FB.pou with METHOD Log]`. Today (re-measure —
      the shell is expected GONE since `f7eb383f47`): `accepted:false`, prose "1 of 2 … Run `volt pull`", no receipt.
      **Red 2026-10-03.** Live: `test/e2e/endpoints/push-keeps-what-landed.test.ts` (prints the whole response and
      the refs after — the snapshot later steps compare against); offline twin
      `Volt.Engine.Tests/sync/PushKeepsWhatLandedTests.An_apply_time_refusal_after_earlier_creates_is_accepted_…`
      (FakeIde C2k: FUNCTION text + METHOD). Measured live on CODESYS SP21 (own instance, fixture copy), push of
      `[enum VltE2E_pk_E.dut, struct VltE2E_pk_ST.dut, FB VltE2E_pk_FB.pou + METHOD Log]`: `accepted:false`, ONE
      conflict `VltE2E_pk_FB.pou`, **code `INTERNAL_ERROR`**, reason "The name 'Log' is not valid for this object. —
      NOTE: 2 of 3 item(s) were already written to the IDE before this one failed, and are not rolled back. Run
      `volt pull` to take them into the workspace, then push again."; no `newItems`; refs after = the two DUTs, **no
      FB shell** (the rollback ran). Two facts the FakeIde twin does not show: the live refusal is NOT a
      `ChildRefusedException` (the CODESYS driver raises it unclassified → `INTERNAL_ERROR`, not `UNSUPPORTED`), so
      the reason also lacks `MemberRefusal`'s "'F' is not created (the create is rolled back)" although the create
      WAS rolled back — for 2.2 / 3.1. The e2e asserts the conflict NAME and the absent shell, not the code.
      Offline the same shape: `accepted:false`, one `F.pou [UNSUPPORTED]` "… 'F' is not created (the create is
      rolled back) … — NOTE: 2 of 3 …", no receipt, `E_A`/`ST_B` exist.
- [x] 1.2 Pre-flight: a batch with TWO INVALID_ST items and two valid items. Today: only the first bad item is named,
      nothing written.
      **Red 2026-10-03.** `PushKeepsWhatLandedTests.A_pre_flight_with_two_malformed_items_names_both_and_writes_nothing`
      (offline: `[Good1, Bad, Bad2, Good2]` → today ONE conflict `Bad.pou [INVALID_ST]`, nothing recorded) and the
      e2e twin in the same file (live CODESYS: ONE conflict `VltE2E_pk_bad1.pou [INVALID_ST]` "Missing
      END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION in 'VltE2E_pk_bad1' …", nothing written, `bad2` unnamed).
      Baseline: the push oracles (`PushServiceTests`, `DeclarationBeforeMembersTests`, `CreateRollbackTests`,
      `UnopenedItemTests`, `PushConflictCodeTests`) 67/67 green, the two new tests red (69 total); volt-cli `tsc` clean.
- [x] 1.G Gate step 1 — review findings (2026-10-03), all four valid:
      F1 (the live code is never asserted) — fixed: the e2e 1.1 now pins `conflicts[0].code == "UNSUPPORTED"` (the
      default chosen: a vendor refusing a member by NAME is the same class as its refusal by kind, DIALECT C2k, and
      the CLI picks its advice by code; owner may pick another) and that the reason says
      "'<FB>' is not created (the create is rolled back)". Red at the driver too:
      `CodesysChildRefusalTests.The_measured_name_not_valid_answer_is_a_refusal_with_the_vendors_words`
      ("The name 'Log' is not valid for this object." → today `ChildRefusal` answers null). 2.2 owns it (below), 4.1
      checks the code.
      F2 (the offline twin takes another path) — fixed: `FakeIde.FailDelete` added; the twin's doc comment no longer
      claims to stand in for `Log`; three new red tests in `PushKeepsWhatLandedTests`:
      `An_unclassified_member_create_failure_after_earlier_creates_is_accepted_and_says_the_create_is_rolled_back`
      (FailCreate "The name 'M' is not valid …" on an FB create in `[E_A, ST_B, F]` — today `accepted:false`
      `INTERNAL_ERROR`, NOTE prose, no rollback word; F rolled back),
      `An_unclassified_failure_whose_rollback_delete_also_fails_says_the_shell_remains` (+ FailDelete on F — today F
      stays and the conflict says nothing of it; only `VoltLog.Warn`), and
      `A_classified_member_refusal_whose_rollback_delete_fails_does_not_claim_the_rollback` (C2k + FailDelete — today
      the reason says "'F' is not created (the create is rolled back)" while F is in the project: `MemberRefusal`
      words it before `Rollback` runs).
      F3 (TwinCAT unmeasured) — MEASURED, no gate: own XAE (`ide.ps1 up -Vendor twincat -Instance
      push-keeps-what-landed`, fixture, then `down`), `VOLT_VENDOR=twincat` e2e 1.1: XAE ALSO refuses `Log` —
      "TwinCAT PLC automation call (ITcSmTreeItem:CreateChild) failed: Creating the child named 'Log' is not possible
      on node (Name mismatch) …", `accepted:false`, ONE conflict `VltE2E_pk_FB.pou [INTERNAL_ERROR]` + NOTE, refs
      after = the two DUTs, no FB shell. Same shape as CODESYS (parity); the test stays ungated on both vendors. Red
      at the driver: `TcChildRefusalTests.The_measured_Name_mismatch_is_a_refusal_with_the_vendors_words`. 1.2 on
      TwinCAT: one conflict `VltE2E_pk_bad1.pou [INVALID_ST]`, nothing written (as CODESYS).
      F4 (untracked `openspec/specs/`) — not this step's; left untouched and not staged.
      Suites (volt-cli, this tree): Engine 1870 pass / 1 skip / **5 red** (the five `PushKeepsWhatLandedTests`, each
      failing on the change's assertion, every premise assertion green), Cli 239, Contracts 19, Connector 113,
      Ide.Twincat 296 / **1 red** (Name mismatch), Ide.Codesys 202 / **1 red** (name not valid), Relay 46,
      Repo.Gates 92 — 2877 pass, 0 unexpected fail, 7 deliberately red (the step's tests); `bun test test/unit` 4/4;
      `tsc` clean; `openspec validate` valid. e2e live (TwinCAT): 2 red as designed. No LSP / fixture / transpiler
      file touched, so no fixture map regeneration and no LSP suite.

## 2. Per-item outcome

- [x] 2.1 Pre-flight collects EVERY refusal (one conflict per refused op, code + reason + line) and still writes
      nothing (`accepted:false`). (Design 1a — per-item application CONFLICTS, owner.) The gate's PER-ITEM conflicts
      (`STALE_ITEM_VERSION`, `ITEM_EXISTS`, `ITEM_MISSING`, `ITEM_UNVERIFIED`, `UNREADABLE`) no longer return before
      the pre-flight: the pre-flight runs over the ops the gate did not name and the response is the UNION (review
      R5: `[stale A, malformed B]` names both). Unchanged, and stated in the spec: `STALE_PROJECT_VERSION` (the lease —
      the client must pull before anything else means something) is answered alone, and `BAD_REQUEST` for the
      request's own shape (`RequireWireNames` / `RequireOneOpPerItem` — a client bug, not an item's content) stops at
      the first offending op. Test red first: `[set A stale ifVersion, set B INVALID_ST]` → two conflicts.
      **Done 2026-10-03.** `PushService.Handle`: the gate returns early only on `STALE_PROJECT_VERSION`; the pre-flight
      runs over every op the gate did not name and COLLECTS (`Reject` split into `ConflictFor` + `RejectAll`); the
      answer is gate ∪ pre-flight in request order, one conflict per op. `BAD_REQUEST` (request shape) unchanged.
      Tests: `PushKeepsWhatLandedTests.A_stale_item_and_a_malformed_item_are_named_together_and_nothing_is_written`
      (`[A STALE_ITEM_VERSION, B INVALID_ST]`, nothing recorded), `A_stale_lease_is_answered_without_the_pre_flight`,
      and step 1's `A_pre_flight_with_two_malformed_items_names_both_and_writes_nothing` green. Live CODESYS (own
      instance): 1.2 names `VltE2E_pk_bad1` AND `VltE2E_pk_bad2` [INVALID_ST], nothing written.
- [x] 2.2 Apply loop: on an IDE refusal STOP (no rollback of earlier ops; a refused create stays rolled back, 2a);
      if the rollback's own delete fails, the conflict says the shell remains. (Design 1c/2b — continuing / restoring
      an update CONFLICTS, owner.)
      ALSO OWNS (gate step 1, F1/F2): (a) both drivers classify the measured member-NAME refusals as
      `ChildRefusedException` — CODESYS "The name '<n>' is not valid for this object.", TwinCAT "(Name mismatch)" —
      so the live `Log` refusal reaches the client `UNSUPPORTED` with `MemberRefusal`'s text (green:
      `CodesysChildRefusalTests` / `TcChildRefusalTests` name tests); check whether the same wording can come from a
      TOP-LEVEL create (an item named `LOG`) and word that case as the item's, not a member's; (b) an UNCLASSIFIED
      create failure still says what of the op the IDE kept ("'F' is not created (the create is rolled back)");
      (c) a failed rollback delete reaches the conflict ("'F' remains …") and no reason claims a rollback that did not
      happen — `MemberRefusal` is worded before `Rollback` runs, so the rollback's outcome must decide the wording
      (green: the three gate-step-1 tests in `PushKeepsWhatLandedTests`).
      **Done 2026-10-03.** Stop at the refusal (unchanged). `OpOutcome` threads through `ApplyOp` to every create;
      `Rollback` records `Created` / `RollbackFault`; `ConflictFor` words it once, for classified and unclassified
      alike ("'F' is not created (the create is rolled back)" or "'F' was created and could not be removed (…): 'F'
      remains in the project"); `MemberRefusal` no longer words a create. (a) `ChildRefusedException.Cause`
      (`Kind`/`Name`); CODESYS `is not valid for this object`, TwinCAT `(Name mismatch)` classified as `Name`; the
      declaration hint only for `Kind`. **Top-level measured live** (CODESYS SP21, own instance `-Instance
      push-keeps-what-landed`, fixture copy, then `down`): `LOG.pou` and `Log.dut` creates refused "The name '…' is not
      valid for this object.", nothing created → wrapped in `WriteItemFromSource` as "the IDE refused to create
      '<name>': <vendor words>" (DIALECT C2k extended). (b)/(c) also for an UPDATE: an unclassified failure after the
      declaration landed / a member was deleted now says so (`UpdateLanded`, same words as `MemberRefusal`).
      Green: the three gate-step-1 tests, both driver name tests, new `The_driver_says_whether_the_kind_or_the_name_is_refused`
      (both drivers), `A_top_level_create_whose_name_the_IDE_refuses_is_worded_as_the_items_refusal` (red first),
      `An_unclassified_failure_of_an_update_after_its_declaration_landed_says_the_declaration_stays`. Live CODESYS 1.1:
      `accepted:true`, the two DUTs in the receipt, ONE conflict `VltE2E_pk_FB.pou [UNSUPPORTED]` "… refused to create
      its method 'Log': The name 'Log' is not valid for this object. — 'VltE2E_pk_FB' is not created (the create is
      rolled back)", refs after = the two DUTs, no shell. TwinCAT not re-run live in this step (4.1).
- [x] 2.3 Dependent ops — already true (one op per item, gate forward simulation, stop-at-refusal makes every later op
      `NOT_ATTEMPTED`); nothing to build (design item 4).
      **Recorded 2026-10-03:** nothing built; `NOT_ATTEMPTED` (2.4) names every op after the stop.
- [x] 2.4 Response: at least one op APPLIED IN FULL → `accepted:true` + receipt + conflicts = the refused op (its
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
      **Done 2026-10-03.** `accepted:true` iff an op applied in full before the refusal: `FlushPendingWrites`,
      `PruneEmptied` over the applied ops only, the receipt walk, `PushResponse.PartialResult` with the refused op +
      `NOT_ATTEMPTED` per later op in APPLY order ("not applied: the push stopped at '<op>'"). Nothing applied →
      `RejectAll` as before, no NOTE. `ConflictCodes.NotAttempted`; `PushResponse.Conflicts` doc; docs `wire.html`
      (#partial-push), `logs.html`, `index.html`; the `DocDataTests` push facts rewritten, `conflictCodes.apply` in the
      data (regenerated, `VOLT_WRITE_DOCS=1`). volt-control: `PushOutcome` `partial`, `describePush` (warn, no
      action). Tests: `Every_op_after_the_refused_one_in_apply_order_is_named_not_attempted`,
      `A_refusal_of_the_first_op_is_rejected_without_a_note_and_names_the_rest_not`, step 1's two accepted-path tests;
      the `MemberRefusal` oracles (`Accepted == false`) unchanged and green.
- [x] 2.4b CLI (`Commands.Push`): on accepted-with-conflicts, `volt/ide` = previous tree + the APPLIED ops' rows only;
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
      **Done 2026-10-03, CLI tests red first** (all three answered `ok` before): `PartialPushCommandTests` —
      `A_partly_refused_push_leaves_only_the_refused_edit_outgoing_and_the_next_push_resends_only_it`,
      `A_rename_landing_beside_a_refused_op_adopts_the_rewritten_reference_and_keeps_the_refused_item_old` (FakeIde
      `RewritesReferencesOnRename`), `A_refused_op_that_partly_landed_needs_a_pull_before_the_next_push` (partial →
      push refused `STALE_ITEM_VERSION` → pull → push re-sends only `K_Motor.pou`). `Commands.Push`: landed ops =
      ops − conflicts; `volt/ide` = previous volt/ide + landed rows (`headPathOf`, blob from HEAD) on the previous
      volt/ide alone, no working-tree merge; adoption (known ∪ landed-produced) − conflicted names, conflicted keep
      old version AND folder; `retiredByPush`, `Rematerialized`, `HeldUnderAnotherName` over landed ops; on a partial
      push the IDE's own layout is pinned (pushed text's version) instead of adopted (a true merge would conflict).
      `ResultKinds.Partial` / `PushResult.Partial`; advice by code and by the receipt (`PartlyLanded`: the item is in
      the receipt at another version than the baseline → "run `volt pull` first"); `Program`: stdout landed count,
      stderr reason, exit 2.
- [x] 2.5 Delete the apply NOTE (`volt pull` … push again) from `PushService.Reject`, AND the CLI advice in every
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

      **Done 2026-10-03.** Deleted: the NOTE (with `Reject`), "Pull first, then push again." ×2, "Pull first," in
      `BodyFormatGuard` ×2 ("change it in the IDE" kept), "Push the fixed text with --force" from
      `ExplorerSnapshot.Reason` (the FACT stays; the same words reached the apply-time `UnreadableItemException`).
      Test: `A_race_refused_after_another_op_landed_carries_no_client_instruction` (accepted, one conflict `B.pou`,
      none of the advice words). Kept, pinned pre-write: `StReader` "Run `volt pull`", `PushConflicts` "--force".
      **Suites (this tree):** Engine 1882 pass / 1 skip, Cli 242, Contracts 19, Connector 113, Ide.Twincat 298,
      Ide.Codesys 204, Relay 46, Repo.Gates 92 — 2896 pass, 0 fail; volt-cli `bun test test/unit` 4/4; volt-control
      122/122; root `typecheck` clean, `lint` exit 0. No LSP / fixture / transpiler file touched.
- [x] 2.G Gate step 2 — review findings (2026-10-03), six, all valid; each fixed with its test red first:
      F1 (`accepted` alone read as "landed in full" by the bridge scripts) — `landedInFull(r)` in volt-lsp-iec
      `scripts/bridge.ts` (+ `bridge.test.ts`); `record-language` (push + delete), `bridge-fixture`, `audit-check`,
      `conversion-matrix`, `probe-position-length`, `probe-is-it-compiled` use it — a partial push is fatal to a recording.
      F2 (e2e ratchets) — `landedInFull` in `test/e2e/lib/workspace.ts` (`pushOps` warning, `cleanup`);
      `callee-seed-lag` asserts the CALLER's conflict and its reason (not `accepted === false`); `refused-shapes` branches
      on `landedInFull`. Not run live on TwinCAT in this fix.
      F3 (rename kept, unsaid; CLI advice wrong) — `OpOutcome.Renamed` (item and task renames): "'X' was renamed to 'Y'
      before it (the IDE rewrote the references to it) and stays renamed"; CLI `PartlyLanded` true when the receipt holds
      the rename target and not the old name → "run `volt pull` first". Tests
      `A_rename_whose_edit_is_refused_after_the_rename_ran_says_the_rename_stays`,
      `PartialPushCommandTests.A_rename_refused_after_the_rename_ran_advises_a_pull_first`.
      F4 (members created / forced replace's delete unsaid) — `UpdateLanded` names members CREATED before the refusal
      ("… was created before it and stays (with its seed text)"); `OpOutcome.Replaced` on `ApplyToUnopened`. Tests
      `An_update_refused_after_it_created_a_member_says_the_member_stays`,
      `A_forced_replace_whose_create_fails_says_the_original_was_deleted`.
      F5 ("pull first" at apply) — `BodyFormatGuard` :156 and every UNPINNED apply-time "… and pull (it)" (case-only
      rename, `CodesysNetworkWriter.Unbuildable`, `TcNetworkWriter` delete/`Refuse`, `TcPlcOpenWriter` ×2, `TcUnmeasured`
      + `TcEnoRefusal`) reworded to name what the IDE can do, no client command. Test
      `A_hidden_body_refused_at_apply_after_another_op_landed_carries_no_client_instruction` (case-insensitive).
      **Left for the owner (pinned by tests):** `InterfaceAccessorGuard` "make the change in the IDE and pull"
      (`InterfaceAccessorGuardTests:116`, LSP fixture `grammar/units.ts:55`) and `TcNetworkWriter` "Add it in the IDE and
      pull it." (`TcNetworkWriterTests:268`).
      F6 (partial push pinned a layout as "another program") — on a partial push the IDE's layout is adopted as on a
      full push: a commit on HEAD with the IDE's text of those items, fast-forwarded, and the partial volt/ide takes
      their text from it; `PushedVersion` deleted. Test
      `PartialPushCommandTests.A_hand_layout_landing_beside_a_refused_op_is_adopted_and_not_reported_as_another_program`.
      Suites: Engine 1886 / 1 skip, Cli 244, Ide.Twincat 298, Ide.Codesys 204, Repo.Gates 92, Contracts 19 — 0 fail;
      volt-cli + volt-lsp-iec `tsc` clean. LSP (scripts only): `scripts/bridge.test.ts` 5/5, test/conformance 5374 pass /
      0 fail, rate:fixtures leaves the map unchanged; test/frontend 1 fail (`0.4 types` baseline) — from the uncommitted
      `src/frontend/types/**` work of another workflow in the tree, not from this fix (no script is imported by it).
- [x] 2.G2 Gate step 2, round 2 — review findings (2026-10-03), six, all valid; each fixed with its test red first:
      F1 (an update's other mutations unsaid) — `MemberChanges` records every step `ReconcileMembers` takes: members
      deleted/created, POU-internal folders created (`TreeNav.ResolveFolder`/`ResolveTopLevelFolder` now report what they
      create), members moved, accessors deleted/created; `UpdateLanded` words each ("the Get accessor of property 'P' was
      deleted before it and stays deleted", "its method 'DoIt' was moved to 'Helpers' …"). Tests (red: the bare refusal)
      `An_update_refused_after_it_deleted_an_accessor_says_the_accessor_stays_deleted` (the repro),
      `…_created_an_accessor_says_the_accessor_stays`, `…_moved_a_member_says_the_move_and_the_new_folder_stay`.
      F2 (CODESYS accessor create "Add it in the IDE, then pull.", INTERNAL_ERROR) — `CodesysDriver.NoAccessorCreate`: a
      `NotSupportedException` (→ UNSUPPORTED), no client command. Test
      `CodesysChildRefusalTests.A_missing_accessor_create_is_a_vendor_cannot_that_names_no_client_command`.
      F3 (move+edit refused after its write) — `MoveItem` records the text written, the destination folders created and
      the move; `RecordMoveKept` (filter) adds them to the reason. Tests
      `A_move_refused_after_its_edit_was_written_says_the_text_and_the_folder_stay`,
      `A_move_whose_second_write_is_refused_says_the_move_stays` (`FakeIde.FailMove` added).
      F4 (CLI "nothing of it landed" vs the forced-replace reason) — the fall-through advice claims nothing the CLI cannot
      see: "fix what the reason names, then push again" (re-sending creates the item, so the action stands). Test
      `PartialPushCommandTests.A_forced_replace_whose_create_fails_is_not_advised_as_nothing_landed`.
      F5 (partial push merged the layout before the ref) — the layout commit is made first, the working tree follows it
      only after volt/ide and the sidecar are written (one merge site with the full path). Test
      `A_partial_push_writes_the_ide_ref_and_the_baseline_before_it_moves_the_working_tree` (index locked once the push
      is at the bridge; red: volt/ide unchanged).
      F6 (`kind-name-cycle` sweep) — `landedInFull` + a refs re-read that throws on leftovers. Not run live (e2e).
      Suites: Engine 1891 / 1 skip, Cli 246, Contracts 19, Connector 113, Ide.Twincat 298, Ide.Codesys 205, Relay 46,
      Repo.Gates 92 — 2910 pass, 0 fail; volt-cli `bun test test/unit` 4/4; volt-control 122/122; root `typecheck`
      clean, `lint` exit 0. LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 7382 pass / 34 skip / 210 todo /
      0 fail (203 files); `scripts/bridge.test.ts` 5/5. No fixture / transpiler file touched → fixture map not regenerated.

## 3. Optional pre-flight

- [x] 3.1 If a live IDE shows a member-name refusal is decidable from the text (e.g. `Log`), add it to pre-flight with
      the measurement recorded; otherwise leave it to 2.2.
      **Measured 2026-10-03 (step 3, no product code changed) — DECIDABLE from the word alone, on both vendors.**
      Probe `packages/volt-cli/scripts/probe-member-name-refusal.ts` (one push per word, each a new FB `VltPkn_<i>`
      with `METHOD <word>`, deleted again when it landed), own instances only (`ide.ps1 up/down -Instance
      push-keeps-what-landed`, fixture copies; CODESYS SP21 pid 13812, TcXaeShell pid 33724). Logs beside it:
      `member-name-refusal.log` / `-tc.log` (vocabulary run: 274 words = LSP `KEYWORDS` ∪ `IL_OPERATOR_WORDS` ∪
      `ELEMENTARY_TYPE_WORDS` ∪ 46 standard-library / system names ∪ 7 casing variants ∪ 24 ordinary controls, then
      every refused word + 12 accepted + casing again as ACTION, PROPERTY and TOP-LEVEL FB, ~220 words × 3) and
      `member-name-refusal-families.log` / `-families-tc.log` (1201 words: every `X_TO_Y` over the 33 elementary
      type words, `TO_<T>`, `TRUNC_<T>`, 16 `ANY_*`, underscore shapes, 40 IEC/system words no list here holds).
      CODESYS 131 s + 206 s; TwinCAT 684 s + 1588 s.
      Numbers. CODESYS vocabulary run: METHOD 208 refused by the IDE (`UNSUPPORTED`, "The name '<w>' is not valid for
      this object.", rolled back) / 2 refused by Volt's pre-flight first (`INVALID_ST`: `END_METHOD`, `IMPLEMENTATION`)
      / 64 accepted; families run 889 refused / 312 accepted. TwinCAT: vocabulary 792 IDE-refused rows of 913 (all
      kinds), families 742 refused / 459 accepted ("Creating the child named '<w>' is not possible on node (Name
      mismatch)"). 4235 IDE verdicts in all.
      (1) **Context-free**: a METHOD named like the FB's own variable (`x`), the FB itself, or an existing project POU
      (`PLC_PRG`) is ACCEPTED on both — the refusal does not depend on the project. (2) **Per word, not per member
      kind**: the IDE's verdict is the same for METHOD / ACTION / PROPERTY / top-level FB on every cross-checked word
      (CODESYS 222 words, 0 disagree; TwinCAT 213, the only 2 "disagreements" were Volt's own `INVALID_ST`, below — since gate 3 they reach
      the IDE and agree: TwinCAT accepts `METHOD END_METHOD` and `PROPERTY END_PROPERTY` as it does the other kinds).
      (3) **Case-insensitive** — first asked of 7 words (`log` `Log` `lOg` `LOG` `sin` `Min` `public`), then (gate 3
      verify run) of every vocabulary word the IDE refused, lower-cased, and of `to_<t>` / `To_<T>` / `int_to_<t>` /
      `<t>_to_int` / `Int_To_<T>` / `<T>_To_Int` over all 33 type words: every verdict matched the upper-case word's.
      (4) **One rule reproduces all 5066 IDE verdicts (distinct vendor × kind × word), 0 wrong**
      (`scripts/member-name-refusal-rule.ts` → `member-name-refusal-rule.log`): refused iff
      the word (upper-cased) contains `__` (`__Foo`, `a__b`, `__TYPEOF`, `BOOL_TO___XINT` … — while `_Foo`, `Foo_`
      are accepted); or is an LSP `KEYWORD` except `GET SET END_GET END_SET OVERRIDE NAMESPACE END_NAMESPACE`
      (accepted on both) and, on TwinCAT only, except `END_METHOD END_PROPERTY END_INTERFACE XSIZEOF VAR_GENERIC`; or
      is an `IL_OPERATOR_WORD`, `CALC`, an elementary type word (TwinCAT: minus `CODESYS_ONLY_TYPE_WORDS`), or one of
      `ANY ANY_INT ANY_NUM ANY_REAL ANY_BIT ANY_STRING ANY_DATE` (the other 13 `ANY_*` probed are accepted); or is a
      conversion operator `<S>_TO_<T>` (S ≠ T) / `TO_<S>` over the SHORT type words of that vendor (all 812 short×short
      pairs refused on CODESYS; the long spellings are no stem — `TIME_OF_DAY_TO_INT`, `TO_DATE_AND_TIME`, and every
      `TRUNC_<T>` except the keyword `TRUNC_INT` are accepted, as are `BCD_TO_INT`, `LEN`, `TON`, `FB_init`, `N`,
      `XINT`). `<T>_TO_<T>` is NO conversion name: `INT_TO_INT`, `REAL_TO_REAL` … (22 on CODESYS, 21 on TwinCAT) are
      ACCEPTED on both; only `TOD_TO_TOD`, `DT_TO_DT` (and on CODESYS `LTOD_TO_LTOD`, `LDT_TO_LDT`) are refused. (The
      first fit refused every short `<T>_TO_<T>` unasked — the families run skipped a == b; the gate 3 review caught
      it, the verify run measured it, 43 verdicts were wrong.) Every CODESYS↔TwinCAT difference is a `CODESYS_ONLY`
      type (`LDATE`/`LTOD`/`LDT`, their conversions) or one of the five TwinCAT-accepted keywords above.
      **Every ACCEPTED is read back** (gate 3): the probe now fetches the item after an accepted push and requires
      exactly one member of the pushed kind named EXACTLY the word (top level: the header names it, no member), else
      it logs `LANDED-OTHER`. The verify run (`PROBE_SET=verify`, `member-name-refusal-verify.log` / `-verify-tc.log`)
      re-asked every row the first runs logged ACCEPTED: CODESYS 411 of 411, TwinCAT 569 of 569 landed exactly as
      pushed (0 `LANDED-OTHER`), so the accept carve-outs (`GET` … `END_NAMESPACE`, TwinCAT's `END_METHOD` …
      `VAR_GENERIC`, every family accept) stand on read-back rows. The three context controls were re-asked too
      (accepted, read back). CODESYS 845 rows in 220 s; TwinCAT 994 rows in ~33 min over two runs (the first stopped
      at a STALE_PROJECT_VERSION on a delete — TcXaeShell moved its project version on its own; the probe now re-asks
      a stale push, up to 5 times, and never logs one as a verdict; resumed with `PROBE_RESUME`).
      What is NOT shown: the rule is FITTED to these words. Its families half was a real prediction (5 conversions
      seen in run 1 → 812 + 66 predicted, all held); its `<T>_TO_<T>` extension was a wrong one (above). So the rule
      is a DESCRIPTION of the measured words, not a pre-flight: a word outside them reaches the IDE and gets 2.2's
      exact apply-time report — a pre-flight built on this refuses ONLY the words an IDE refused in these logs (per
      vendor, any case — case-insensitivity is measured), never a word the rule merely predicts. The vendors' own
      lists are not reachable by API (none probed).
      Corpus (six real corpora, `packages/volt-lsp-iec/test-corpus`): 0 of 29170 items and 0 of 57275 METHOD / ACTION
      / PROPERTY declarations carry a name the rule refuses (projects pulled from an IDE cannot hold one).
      Finding beside it (Volt's own pre-flight, not the IDE) — **FIXED in gate 3**: a unit NAMED after its own END
      keyword (`METHOD END_METHOD`, `ACTION END_ACTION`, `PROPERTY END_PROPERTY`, top-level `END_FUNCTION_BLOCK` /
      `END_PROGRAM` / `END_FUNCTION`) was refused `INVALID_ST` "END_METHOD stands after code on its line …", a mistake
      the text does not hold. See 3.G.
      **Verdict:** FITS (design item 6) — a per-vendor, word-only check in the driver's `ValidateSource` (CODESYS and
      TwinCAT each with the words its IDE refused in these logs, `UNSUPPORTED` with the vendor's measured words) would
      move every measured `Log`-class refusal before the first write. Not built in this step (MEASURE); the box stays
      open for it.
      **Built 2026-10-03 (verify session), tests red first.** `ICodeStore.RefusedName(name)` (DriverBase: null — no
      measurement, no guess); each driver answers from a word list that IS its IDE's logged refusals — not the rule:
      `Volt.Ide.Codesys/Driver/CodesysRefusedNames.cs` (1092 words) and `Volt.Ide.Twincat/Driver/TcRefusedNames.cs`
      (933 words), every word a live IDE refused in the six logs (Volt's own `INVALID_ST` rows excluded; a later log
      overrides an earlier row), upper-cased and matched case-insensitively (measured). Repo.Gates
      `RefusedNamesMatchTheLogsTests` holds each file to its logs (and fails if a word was refused as one kind and
      accepted as another — the per-word verdict is measured, 0 such words); `VOLT_WRITE_REFUSED_NAMES=1` regenerates.
      The pre-flight (`PushService.ValidateSourceOrThrow`, every set op) asks the driver for every METHOD / ACTION /
      PROPERTY name the text carries (create and update — an existing member cannot hold a word its IDE refuses to
      create, so only a new one can be refused) and, on a create, for a `.pou`'s own name; a refused name is
      `UNSUPPORTED` (`ChildRefusedException`, cause NAME), e.g. "the IDE refuses to create method 'Log' in
      'VltE2E_pk_FB2': CODESYS does not take 'Log' as a name ("The name 'Log' is not valid for this object.")", and
      nothing is written. Not asked: interface members, DUT / GVL / interface item names (unmeasured kinds).
      Red first: `PushKeepsWhatLandedTests` 3 of 4 new tests red (member on a create, member added by an update,
      `LOG.pou`), `CodesysNameRefusalTests` / `TcNameRefusalTests` (11 / 10 rows; compile-red), the Repo.Gates test
      (2 red: files missing). Live, both vendors: `METHOD Log` beside a DUT create → `accepted:false`, ONE conflict
      `UNSUPPORTED` naming method 'Log', nothing written (e2e `push-keeps-what-landed.test.ts`, the new 3.1 case).
      Consequence for 4.1: `Log` no longer reaches the apply loop, so the apply-time e2e uses `Vlt__Log` — a word no
      probe asked (`a__b` was refused, this one never asked), which both IDEs refused at apply, as the rule predicted.
      Cost: a word an IDE version other than the measured two (SP21, 4024.74) would accept is refused if the measured
      one refused it; 0 of 57275 corpus member declarations carry a listed word.
- [x] 3.G Gate step 3 — review findings (2026-10-03), four, all valid:
      F1 (ACCEPTED never read back) — `probe-member-name-refusal.ts` `readBack`: an accepted push is fetched
      (`onlyItems`) and must hold exactly one member of the pushed kind named exactly the word, else `LANDED-OTHER`.
      `PROBE_SET=verify` re-asked every earlier ACCEPTED row live on both vendors: CODESYS 411/411, TwinCAT 569/569
      landed as pushed, 0 `LANDED-OTHER` (numbers in 3.1). No carve-out changed.
      F2 (rule refuses unmeasured names) — measured instead of argued: the verify run asked all 33 `<T>_TO_<T>` and
      ~370 lower / mixed-case words per vendor. Case-insensitivity HELD on every one; `<T>_TO_<T>` did NOT: 43 of the
      rule's refusals were wrong (INT_TO_INT … accepted on both). The rule now refuses `<T>_TO_<T>` only for the four
      measured date-and-time stems and reads 5066 verdicts, 0 wrong; its header and 3.1 say it describes the measured
      words and that a pre-flight refuses only the logged ones.
      F3 (TwinCAT "accepts" `METHOD END_METHOD` / `PROPERTY END_PROPERTY` written as a measurement) — now measured: with
      F4's fix both reach TcXaeShell and are ACCEPTED, read back (`member-name-refusal-verify-tc.log`).
      F4 (Volt's own pre-flight misdiagnoses a unit named after its END keyword; filed niche without a cost) — cheap,
      so fixed: `StReader.RefuseEndAfterCode` skips the header's NAME position (`HeaderNameAt`: the word after the
      member keyword — or, for the outer block, after the header its END closes — and any access modifiers); any other
      occurrence on the line is still refused. Tests first (red 10 of 78): `ChildSplitterTableTests` rows "a METHOD
      named END_METHOD", "… with a modifier named end_method", "an ACTION named END_ACTION", "a PROPERTY named
      END_PROPERTY", "interface: a METHOD named END_METHOD", "… with END_METHOD after it on the line" (still refused),
      `An_item_named_after_its_outer_END_keyword_reads` ×5, `…_still_refuses_that_END_after_code`. Live: CODESYS now
      answers its own `UNSUPPORTED` "The name 'END_METHOD' is not valid for this object." for all six (was Volt's
      `INVALID_ST`); TwinCAT ACCEPTS `METHOD END_METHOD` and `PROPERTY END_PROPERTY` (Volt refused them before) and
      itself refuses `ACTION END_ACTION` and the three top-level END words. Left: a member named END_METHOD still can
      not be referenced from a member body (`x := END_METHOD();` reads as an END after code, refused naming the line)
      — niche: accepted loss (0 occurrences in the corpora: 0 of 57275 member declarations carry such a name).
      `IMPLEMENTATION` as a name stays Volt's deliberate `INVALID_ST` (the body marker; accurate reason).
      Also fixed: the two step-3 scripts imported the LSP's vocabulary statically, which failed volt-cli's typecheck
      (TS6059, rootDir) — now a typed dynamic import.
      Suites: Engine 1903 / 1 skip, Cli 246, Contracts 19, Connector 113, Ide.Twincat 298, Ide.Codesys 205, Relay 46,
      Repo.Gates 92 — 0 fail; volt-cli `bun test test/unit` 4/4, `tsc` clean; volt-control 122/122; root `typecheck`
      clean, `lint` exit 0. LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 7856 pass / 34 skip / 330 todo /
      0 fail (203 files). No fixture / transpiler file touched → fixture map not regenerated.

## 4. Verify

- [x] 4.1 1.1 now, live on BOTH vendors: `accepted:true`, the DUT in the receipt, `FB.pou` the only conflict with
      code `UNSUPPORTED` and a reason saying it is not created (rolled back), no shell, `refs` matches the receipt. 1.2 now: both bad items named, nothing written.
      **Done 2026-10-03**, own IDEs on fixture copies (`ide.ps1 up -Instance e2e-verify`; CODESYS SP21 pid 43816 on
      CodesysTestProject, TcXaeShell pid 12248 on Project13 and pid 42444 on Project14 — 12248 exited on its own
      between runs, so the second TwinCAT run is on Project14), bridges built from the worktree at `62bcb30d65` + the 3.1
      change. `test/e2e/endpoints/push-keeps-what-landed.test.ts` 3/3 on CODESYS and 3/3 on TwinCAT (both projects).
      1.1 (METHOD `Vlt__Log`, see 3.1): `accepted:true`, `newItems` holds `VltE2E_pk_E.dut` and `VltE2E_pk_ST.dut`,
      ONE conflict `VltE2E_pk_FB.pou [UNSUPPORTED]` "'VltE2E_pk_FB': the IDE refused to create its method 'Vlt__Log':
      The name 'Vlt__Log' is not valid for this object. — 'VltE2E_pk_FB' is not created (the create is rolled back)"
      (TwinCAT: "… Creating the child named 'Vlt__Log' is not possible on node (Name mismatch) …" + the same rollback
      words), refs after = the two DUTs (no shell), `newProjectVersion` = the next refs, no client advice word. 1.2:
      `accepted:false`, two conflicts `VltE2E_pk_bad1.pou` / `VltE2E_pk_bad2.pou [INVALID_ST]`, nothing added.
      3.1: `METHOD Log` → `accepted:false`, one `UNSUPPORTED` conflict, nothing added.
- [x] 4.2 CLI push of a partially refused batch updates the baseline for applied items (and the receipt's
      rewritten known items) only; full suites green.
      **Done 2026-10-03, live on both vendors** — new e2e `test/e2e/endpoints/push-keeps-what-landed-cli.test.ts`
      drives the built `volt.exe`: `volt init` on the served project, commit a new enum DUT and a new FB with METHOD
      `Vlt__Log`, `volt push` → exit 2, stdout "pushed 1 item(s)", stderr "the push landed in part: 1 of 2 item(s) are
      in the IDE, these are not: VltE2E_cp_FB.pou: [UNSUPPORTED] … → the IDE will not take this text; change it, then
      push again"; `refs/remotes/volt/ide` holds the DUT's path and not the FB's; `volt status --porcelain` outgoing =
      exactly `oA …/VltE2E_cp_FB.pou` (CODESYS: `Device/Plc Logic/Application/…`, TwinCAT: top level); the method
      renamed and committed, the next `volt push` exits 0 "pushed 1 item(s)" and nothing is outgoing. 1/1 on CODESYS
      (12.0 s) and on TwinCAT Project14.
      **Suites (worktree of `62bcb30d65` + this change):** C# Engine 1916 pass / 1 skip, Cli 251, Contracts 31,
      Connector 115, Ide.Twincat 329, Ide.Codesys 226 (net48), Relay 46, Repo.Gates 94 — 3008 pass, 0 fail; volt-cli
      `bun test test/unit` 4/4; `bun run check` 15 passed, 0 failed. e2e: CODESYS `test:e2e:codesys` 248 pass / 24 skip /
      0 fail (272 tests, 51 files, 280 s); TwinCAT `test:e2e:twincat` 248 pass / 24 skip / 0 fail (272 tests, 1041 s, Project14).
      Gates the first suite run caught, fixed: `WireVocabularyGuardTests` (the member-kind words were re-spelled — the
      message now uses `m.Kind`), `NoKindFromTextTests` (the word lists spell FUNCTION / PROGRAM / TYPE … as NAMES —
      allow-listed, 7 lines each), `DocDataTests` (the driver interface grew `RefusedName` — `VOLT_WRITE_DOCS=1`).
      Found on the way: `ide.ps1`'s TwinCAT readiness pattern ("attached to TwinCAT …") stopped matching when
      ide-identity-report 2 changed the worker's attach line to the IDE's own name ("attached to TcXaeShell 15.0 by
      Beckhoff (xae pid N)"), so every attach was killed after its 60 s window and `up` gave up after 10 — fixed to key
      on the pid.
