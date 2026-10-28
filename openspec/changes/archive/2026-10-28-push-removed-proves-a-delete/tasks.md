## 1. Pin the receipt

- [x] 1.1 `FakeIde`: a delete that reports success and keeps the item (the CODESYS delete-child shape).
- [x] 1.2 Test: that delete lands per the push, and its path is not in `removed`.
- [x] 1.3 Test: a landed delete of an item under a receipt-walk `unwalkedFolders` entry is not in `removed`; fix
      `Receipt.Gone` if it is.
- [x] 1.4 Decide how the push states a delete that did not take (conflict code, or `newItems`), document it in the
      `push` outcomes.
      Decided (Volt's call, no new code, protocol stays 1): a CONFLICT, raised where the delete ran. After the IDE answers a
      delete, `RequireDeleted` looks the path up again; an item still there (read or not) is a post-condition the IDE broke
      — `IDE_LOST_ITEM` (its doc widened to "does not hold what Volt just did … an item whose delete it answered and still
      holds") — so the push stops there like any apply-time refusal: the op is not landed, every later op NOT_ATTEMPTED,
      no `partiallyApplied`, its path in neither `removed` nor `newItems`. `newItems` was rejected: it would keep the push
      "landed", and the CLI would still point volt/ide at a HEAD without the file while the sidecar kept it (the review's
      silent state). As a conflict the CLI's partial-push path keeps the file in volt/ide and the delete outgoing.
      Outcome line in `DocDataTests` ("A `deleteItem` lands only when its item is gone: …"), docs regenerated, wire shape
      re-pinned (outcome text only: no member added, removed or re-meant). Census: IDE_LOST_ITEM in PushService 6 → 7.

### Gate 1a (2026-10-28)

- Review finding (1.2 pinned the silent `Landed()`): fixed. Red first — `A_delete_the_ide_answered_and_did_not_perform_is_refused_not_removed`
  and the new `A_delete_that_did_not_take_stops_the_push_and_keeps_what_landed_before_it` failed (Landed true / no
  conflict), green after `RequireDeleted`.
- Numbers: Volt.Engine.Tests 2443 pass / 1 skip, Volt.Cli.Tests 377/377, Volt.Contracts.Tests
  56/56, Volt.Connector.Tests 156/156, Volt.Ide.Twincat.Tests 782/782, Volt.Ide.Codesys.Tests 523/523, `bun run typecheck`
  clean. Volt.Repo.Gates 274/276: both reds are TcArchive.cs (`FlagBits` with no src caller; UNSUPPORTED census 2 vs 8),
  from another lane's commits (1f1f315538..c7067d639f) landed during this step — not this change's paths; the
  IDE_LOST_ITEM census this step moved passes.

### Gate 1b (2026-10-28)

- [x] Finding 1 (medium, `RequireDeleted` fault after the delete ran): fixed. Red first —
      `A_delete_whose_check_faults_on_a_sibling_is_partially_applied_and_the_receipt_proves_the_removal` (a sibling's name
      read faults once `delete:A` ran) failed on `partiallyApplied` null. A fault in the post-delete look-up now records
      `OpOutcome.DeleteRan`, so the refusal (its own code, `ITEM_UNVERIFIED`) is `partiallyApplied` and its reason says the
      IDE ran the delete; the receipt walk then decides `removed` as for any partly applied op (`F/A.pou` is in it). An
      item that is still there stays `IDE_LOST_ITEM` with nothing applied (unchanged). FakeIde `FaultingNameReads` is
      settable so a fault can start mid-push.
- [x] Finding 2 (low, unopened arm uncovered): `A_forced_delete_of_an_unopened_item_that_did_not_take_is_refused_not_removed`
      pins `ApplyToUnopened`'s `RequireDeleted`; mutation-checked (removing that call turns it red).
- [x] Finding 3 (low, no CLI-layer pin): `PartialPushCommandTests.A_delete_the_IDE_did_not_perform_stays_in_volt_ide_and_outgoing`
      — `volt push` (an edit + a delete the IDE does not perform) is partial, `volt/ide` and the baseline still hold
      `Z_Stays.pou`, `volt status` shows only that delete outgoing and nothing incoming, and the next push re-sends exactly
      that delete. Green on the current code (it pins the 1.4 reason, no product change needed).
- Numbers: Volt.Engine.Tests 2444 pass / 1 skip (+2), Volt.Cli.Tests 378/378 (+1), Volt.Contracts.Tests 56/56,
  Volt.Connector.Tests 156/156, Volt.Ide.Twincat.Tests 784/784, Volt.Ide.Codesys.Tests 535/535, Volt.Repo.Gates 276/276,
  `bun run typecheck` clean. No fixture, LSP or transpiler change, so no fixture-map regeneration and no LSP suite. (The
  TwinCAT/CODESYS counts include another lane's uncommitted network-reader work in the tree; none of it is this step's.)

## 2. Docs

- [x] 2.1 `push` outcome sentence: `removed` names only paths whose folder the receipt walk read and that it no longer
      holds.
      Outcome line added in `DocDataTests` (push), `PushResponse.Removed` summary says the same; `data.js` and
      `volt-bridge.openrpc.json` regenerated (`VOLT_WRITE_DOCS=1`); wire shape re-pinned without a bump (outcome text
      only). Numbers: Volt.Engine.Tests 2444 pass / 1 skip, Volt.Repo.Gates 276/276, Volt.Contracts.Tests 56/56.

### Gate 2 (2026-10-28)

- [x] Review finding (low, the outcome sentence read "paths the receipt walk read and no longer holds" — the walk cannot
      have read a path it no longer holds): fixed. The condition is on the FOLDER (`Receipt` → `Gone`: held before, folder
      not under a receipt `unwalkedFolders` entry, not held now), as the spec delta says. Reworded to "`removed` names only
      paths whose folder the receipt walk read and that it no longer holds" in the `DocDataTests` push outcome, the
      `PushResponse.Removed` summary and the pin comment; `data.js` / `volt-bridge.openrpc.json` regenerated. Red first —
      `The_committed_doc_data_is_what_the_code_generates` and `The_wire_shape_is_pinned_beside_its_protocol_number` failed
      on the new sentence; re-pinned without a bump (outcome text only, no member added, removed or re-meant; protocol 1).
- Numbers: Volt.Engine.Tests 2444 pass / 1 skip, Volt.Cli.Tests 378/378, Volt.Contracts.Tests 56/56,
  Volt.Connector.Tests 156/156, Volt.Ide.Twincat.Tests 784/784, Volt.Ide.Codesys.Tests 535/535, Volt.Repo.Gates 276/276,
  `bun run typecheck` clean. The two IDE suites ran in a clean worktree of HEAD + this step's diff: in the shared tree they
  do not compile because of another lane's untracked `Scratch*.cs` census probes (CS0104 `Parallel` ambiguous), not this
  change's paths. No fixture, LSP or transpiler change, so no fixture-map regeneration and no LSP suite.

## 3. Close (2026-10-28)

- [x] 3.1 Final review, SPEC and LAYERING lenses over the whole change. LAYERING: clean — `RequireDeleted` sits in
      `Volt.Engine/Sync` and looks up through the vendor-blind `TreeLookup`; `FakeIde` stays in `test/shared`; the wire
      change is doc text in `Volt.Contracts`. SPEC: one finding, fixed test-first — the 1b refusal's reason named the
      item by its BARE name (`ItemPath.BareOf`), while an item is always its full path on the wire. Red first
      (`A_delete_whose_check_faults_on_a_sibling_is_partially_applied_and_the_receipt_proves_the_removal` asserts the
      reason "the IDE ran the delete of 'F/A.pou' before the check faulted, so it may be gone"), green after
      `OpOutcome.DeleteRan` carries the path. `PushConflict.PartiallyApplied`'s summary now lists that case, and
      design.md states the faulting-check exception (it read "no `partiallyApplied`" without it).
- [x] 3.2 Numbers (HEAD + this step, clean worktree — the shared tree's untracked `Scratch*.cs` probes are another
      lane's): Volt.Engine.Tests 2444 pass / 1 skip, Volt.Cli.Tests 378/378, Volt.Contracts.Tests 56/56,
      Volt.Connector.Tests 156/156, Volt.Ide.Twincat.Tests 784/784, Volt.Ide.Codesys.Tests 535/535, Volt.Repo.Gates
      276/276, `bun run typecheck` clean. LSP full suite COLD (`VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1`): first run
      10184 pass / 53 fail, every fail `transpile-replay` linking with LNK1201/LNK1318 (PDB write) on a 100%-full C:
      (4.5 GB free); after freeing space `transpile-replay.test.ts` alone cold 6309/6309, then the full suite re-run
      cold: see 3.3.
- [x] 3.3 LSP full suite re-run COLD (`VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 10237 pass / 36 skip /
      431 todo / 0 fail, 10704 tests across 365 files (951 s). No fixture, LSP or transpiler change in this change, so no
      fixture-map regeneration.
