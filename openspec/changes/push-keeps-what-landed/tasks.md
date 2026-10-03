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

- [ ] 3.1 If a live IDE shows a member-name refusal is decidable from the text (e.g. `Log`), add it to pre-flight with
      the measurement recorded; otherwise leave it to 2.2.

## 4. Verify

- [ ] 4.1 1.1 now, live on BOTH vendors: `accepted:true`, the DUT in the receipt, `FB.pou` the only conflict with
      code `UNSUPPORTED` and a reason saying it is not created (rolled back), no shell, `refs` matches the receipt. 1.2 now: both bad items named, nothing written.
- [ ] 4.2 CLI push of a partially refused batch updates the baseline for applied items (and the receipt's
      rewritten known items) only; full suites green.
