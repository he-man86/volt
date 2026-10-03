## Why

**One refused item makes a client redo a whole batch, and the project is left half-changed with no exact record of
which half.**

Reproduced in PLCAssist on CODESYS 3.5.21.40, 2026-10-01 (first seen in a customer chat, `9bbfea56`): one push of
`[create an enum DUT, create a struct DUT, create FB_ReproLogger.fb whose METHOD is named Log]`.

- The IDE refused the method name `Log` (it is the IEC standard function LOG) — a refusal only the live IDE makes,
  so it came from the apply loop, after the first two creates were written.
- The rejection said `NOTE: 2 of 3 item(s) were already written … Run \`volt pull\`…`. In fact **all three** items
  existed afterwards: the FB had been created as an empty declaration-only shell before its method was refused.
  `applied` (PushService.cs) is only appended after `ApplyOp` returns, so the half-made item is never counted.
- The response was `accepted: false`, every op looked refused, and what landed existed only as a count inside
  English prose. A client cannot tell which items to re-send, so the AI re-sends the whole batch — and its creates
  of the already-written items then fail ITEM_EXISTS.
- The reason told an end user to run `volt pull`, a CLI command that means nothing outside the CLI.

The same cost applies to the refusals decided before anything is written: one malformed item in a nine-item batch
(INVALID_ST, NETWORK_*, a stale version on one item) refuses all nine, and the client regenerates all nine.

**What PLCAssist needs:** what landed stays landed, the client re-sends ONLY the refused items, and the response says
exactly which is which. The wire already has the shape for it: `accepted: true` WITH `conflicts`, plus the
`newItems` receipt. PLCAssist already reads that shape as "partial" (each op landed unless a conflict names it).

## Gate: only where it matches volt's design (owner, 2026-10-01)

This is what PLCAssist NEEDS, not a design handed to volt. Before implementing any part of it, check it against
volt's own design — the push model the CLI and workspace are built on, the pre-flight/apply split, the existing
rule that a push does not roll back ("a half-undone push is worse than a half-done one", PushService.Reject), and
anything in the docs or other open changes that decides the same question. Implement only the parts that fit. For a
part that does not, do NOT build it: record in this change why it conflicts and what volt-native alternative gives a
client the same thing (re-send only what failed, know exactly what landed), and leave it for the owner to decide.

## What Changes

> **Superseded in part by the design gate (2026-10-03, `design.md` "Step 0").** The list below is what PLCAssist
> asked for, kept as the request. What is built is the rewritten `specs/bridge-push/spec.md` and `tasks.md`.
> **Decided not to be built (owner, 2026-10-02/03 — keep all-or-nothing):** 1 as per-item application of pre-flight
> and gate refusals (instead, every refusal is named in one response and nothing is written); 1 as continuing past an
> IDE refusal (instead, the push stops and names every op not reached, `NOT_ATTEMPTED`); 2 as restoring an update's
> previous text (instead, the conflict states what of the update landed and the CLI keeps its old baseline); 5 for
> the pre-write remedies pinned by oracle tests; `accepted:true` for a single partly-landed op. The Impact line
> "restore previous text" is not built either.

1. **Per-item outcome.** An item refused for its own reasons — pre-flight (INVALID_ST, NETWORK_*, UNREADABLE,
   UNSUPPORTED, STALE_ITEM_VERSION, ITEM_EXISTS, ITEM_MISSING, ITEM_UNVERIFIED, DUPLICATE_CHILD) or by the IDE during
   apply — is refused ALONE; every other item in the batch is still applied.
2. **A refused item leaves nothing behind.** When the IDE refuses an item part-way (an object created, then a member
   rejected), the bridge undoes that item's own partial effect: a create it began is removed, a set on an existing item
   leaves the item's previous text. No empty shells.
3. **The response says exactly what happened**, in the existing shape:
   - at least one item applied → `accepted: true`, `conflicts` naming each refused item (code, reason, line), and the
     usual `newItems` / `newFolders` / `newProjectVersion` receipt;
   - nothing applied → `accepted: false` as today.
4. **Whole-batch refusal only where the batch as a whole is wrong:** the project lease (`STALE_PROJECT_VERSION`) and
   a malformed request (`BAD_REQUEST` for the request itself). An op that depends on a refused op in the same batch
   (e.g. a set on the name a refused rename would have produced) is refused with it, with a reason that says so.
5. **Reasons are client-neutral.** No CLI instructions (`volt pull`, `push again`) in `conflicts[].reason`; the CLI adds
   its own advice from the code.
6. **Optional, if measurable:** catch IDE-only member-name refusals (like `Log`) in pre-flight, so they never start an
   apply. Only for limits measured on a live IDE, not a guessed reserved-word list.

## Impact

- `Volt.Engine/Sync/PushService.cs` (pre-flight and apply loop, the per-item undo), `PushConflicts`, the drivers'
  ability to remove a just-created item / restore previous text, `PushModels` docs (an accepted push may carry
  conflicts).
- The CLI: an accepted push with conflicts updates the baseline for the applied items only.
- Clients: PLCAssist already handles `accepted: true` + `conflicts` as partial and marks each op landed or refused;
  its model then re-sends only the refused items. Nothing to change beyond verifying it live.

## Close-out (2026-10-03)

Built and verified live on CODESYS SP21 and TcXaeShell 4024.74 (tasks 4.1 / 4.2): every pre-write refusal in one
answer with nothing written; an apply-time IDE refusal → `accepted:true`, the exact receipt, the refused op named with
its code, `NOT_ATTEMPTED` after it, a refused create rolled back (no shell) or the reason saying it remains; reasons
without CLI instructions; the CLI adopting only what landed. Item 6 is built from measurements, not a guessed list:
each driver refuses before the first write exactly the names its IDE was measured to refuse (`Log` among them).
**Owner decision:** keep all-or-nothing — the items above marked "decided not to be built" are closed, not deferred.
