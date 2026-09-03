# Close-out — superseded: every task targets machinery that no longer exists

Closed 2026-09-03 with 0 of 17 done, because **the code it was written against has been replaced.**

## What it was

A CODESYS-only follow-on to `splice-graphical-body`. Its plan was to take that change's loss census and drive it
to zero: derive "can network text express this?" from the format (§1.1), transplant non-expressible elements from
the stored network onto the regenerated one by `localId` (§2.1), shrink `KnownLoss` empirically (§2.2), then
delete `SafeToDrop` and turn `KnownLoss` into `Assert.Empty` (§3.2, §3.3).

Its scope note is explicit about the premise: *"CODESYS keeps PLCopen, keeps projecting a graph through network
text and back, and therefore keeps every loss this change exists to stop."*

## Why it is closed

**Both the premise and the apparatus are gone.**

- CODESYS does not keep PLCopen. Neither vendor transports content as a document; each driver reaches its own
  vendor's native form below the seam, and both ship an identical `NWLObject` model differing only in ACCESS
  (DIALECT N1). The engine's PLCopen layer was deleted, not moved.
- Every symbol its tasks operate on — `StoredVsPushedTests`, `KnownLoss`, `SafeToDrop`, `blind`,
  `BodySpliceGuard`, `NetworkSplice` — is absent from the tree. `grep` finds none of them in `src` or `test`.

A task list where every noun has been deleted cannot be finished; it can only be rewritten, and rewriting it
would be a different change with a different argument.

## The concern was real, and it was answered another way

Graphical push losses were not dismissed — they were attacked directly against the architecture that shipped,
and measured against a real customer project rather than a fixture. On the Lenze corpus the pushable-network
count went **221 → 373 of 373**, closing losses this change had only planned to census: the fan-out wire that
pulled as `out := ( AND b);` with the wire silently gone (573 occurrences in one project), the fed parallel, the
unconditional jump, the opaque leaf turned into a call box.

What this change would still add, on the current architecture, is the **discipline** rather than the fixes: a
census that ratchets, so the loss set may only shrink and a baseline entry that stops happening also fails.
`splice-graphical-body`'s close-out records that pattern working. If graphical fidelity needs a gate again, that
is the shape to rebuild — against `NWLObject` and network text, not against a PLCopen splice.

## What is NOT carried forward

§3b.1–3b.4, the declaration boundary-whitespace items, are unrelated to the graphical subject and were parked
here by proximity. They remain unaddressed and unmeasured: nobody has shown the whitespace loss still occurs on
the current declaration path. If it does, it is a bug report, not an epic.
