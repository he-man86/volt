> From PLC Assist, 2026-10-25 (sweep finding P12). Spec only; Volt source untouched.

## Why

PLC Assist re-reads `refs` after every push that landed a delete, to catch a delete the IDE accepted and did not
perform (the CODESYS delete-child case: "accepted" is the bridge saying it ran the call, not that the object is gone).
The final wire's receipt could make that round trip unnecessary: `newItems` and `removed` are what the push changed,
so `baseline − removed + newItems` is the IDE after it (`docs/assets/data.js`, `push`), and `PushService.Receipt`
names a landed delete's path in `removed` "only when the walks agree (held before, gone after)", the receipt being a
fresh full walk, the same one `refs` makes (`PushService.cs` 405-409, 476-478, 503-507).

What is missing is the PIN: no test drives a delete the IDE reports done while the item stays, and checks that its
path is absent from `removed`. `FakeIde` deletes always take, so the property holds by reading the code only, and
PLC Assist's rule is to drop its own check only when Volt's contract guarantees it (its `volt-wire-final-shape` 2.2
waits on exactly this).

## What Changes

- A test (engine level, `FakeIde` taught a delete that answers success and leaves the item) pinning: a landed
  `deleteItem` whose item is still in the receipt walk is NOT in `removed`, and the push says so the way the contract
  chooses (a conflict, or the path in `newItems` with its version — Volt's call).
- The `push` doc states it in one sentence: `removed` names only paths the receipt walk no longer holds.
- An item under one of the receipt walk's `unwalkedFolders` is never claimed removed by a landed delete either (today
  `Gone` checks only the receipt's versions, so an unwalked folder reads as "gone").

## Impact

`Volt.Engine` tests (`PushService` receipt), `FakeIde`, `docs/` push outcomes. No wire change unless the owner picks
the conflict for the not-performed delete. PLC Assist then reads `removed` and drops the post-delete `refs`.
