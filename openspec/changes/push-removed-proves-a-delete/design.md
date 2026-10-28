## How a push states a delete that did not take (1.4)

**Target.** `removed` is proof: a client takes a path in it as "the IDE no longer holds this" without reading `refs`
again. A delete the IDE answers and does not perform (the CODESYS delete-child shape) must therefore never be in
`removed`. The answer must also say that the delete did not take.

**Choice: a conflict, `IDE_LOST_ITEM`, raised where the delete ran.** After the IDE answers a `deleteItem` (both the
plain and the unopened-item arm), `PushService.RequireDeleted` looks the path up again (`TreeLookup.Locate`). If the
item is still there, read or not, the IDE broke a post-condition of the apply. The push stops there like any
apply-time refusal: the op is not landed, every later op is `NOT_ATTEMPTED`, there is no `partiallyApplied`, and the
path is in neither `removed` nor `newItems`. Ops before it keep their own landed outcome.

Why: the CLI already handles an apply-time conflict as a partial push. It keeps the file in `volt/ide` and the delete
outgoing, so the next push tries it again and the user sees the refusal by name. `IDE_LOST_ITEM` already means "the IDE
does not hold what Volt just did". This widens it to "or holds what Volt just deleted", so no new code is needed.

**Rejected:**
- *Path in `newItems` with its version, push stays landed*: the CLI would point `volt/ide` at a HEAD without the file
  while the IDE still holds it. That is silent drift, which is the state this change removes.
- *A new code (`DELETE_NOT_PERFORMED`)*: this is a wire vocabulary change (protocol 2) for a fact the existing code
  already states. The message names the path and the cause.
- *Leave it to the receipt (`Gone` absent, push landed)*: `removed` would be correct, but the push would still say
  "landed". The client gets no signal and keeps a delete it thinks is done.

**Still refused by name.**
- `removed` names a path only when the receipt walk READ its folder and no longer holds it. A landed delete or move
  under a receipt `unwalkedFolders` entry is not claimed removed (1.3).
- A delete that quotes a version of an item that is not there stays the version-gate conflict. A delete that quotes no
  version is still `no-op`.

**Migration.** None on the wire: protocol stays 1, and no member is added, removed or given a new meaning. The outcome
text is the only change. The `push` outcome line in `DocDataTests` ("A `deleteItem` lands only when its item is gone:
…") regenerates `docs/assets/data.js` and the OpenRPC doc. The `IDE_LOST_ITEM` census in `PushService` goes from 6
to 7. PLC Assist can drop its post-delete `refs` read: a delete that did not take is a conflict, and `removed` is
proof.
