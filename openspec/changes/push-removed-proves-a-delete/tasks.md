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

## 2. Docs

- [ ] 2.1 `push` outcome sentence: `removed` names only paths the receipt walk read and no longer holds.
