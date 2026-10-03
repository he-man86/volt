## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our tool census observed, and
our reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**What of a refused op the IDE kept is stated only in the conflict's prose.** A client must parse English to know
whether to re-read an item before retrying it.

Background: `push-keeps-what-landed` (archived 2026-10-03) made the push say, for the op the live IDE refused, what of
that op stays: an update's declaration or a member it deleted, a create whose rollback failed, a native rename that
ran first, the delete before a forced replace. The engine records each one as it happens, in a structured object, and
then words it into `reason`.

What PLCAssist sees (tool census 2026-10-03, CODESYS 3.5.21.40, next bridge on volt `457b6a700b`):
- None of the census refusals (W4, W5, W9, W11) left anything behind, so their reasons say nothing kept.
- PLCAssist still tells its model, on every refusal, "If a refusal's reason says part of that item was kept, re-read it
  before retrying" (148 characters), because it cannot know from the wire when that is true. The model is asked to
  read prose that is almost always absent.
- When it IS true (a renamed item, a declaration written), re-sending the op unchanged is wrong: the op's name may no
  longer exist, or its version is stale. That is a decision a client should make from a field.

What the code shows (volt `457b6a700b`):
- `PushService.OpOutcome` (`PushService.cs:338-352`): `Created` + `RollbackFault`, `UpdateKept`, `Renamed (From, To)`,
  `Replaced`.
- `ConflictFor` (`PushService.cs:372-392`) turns them into `reason` suffixes ("… and stays renamed", "… remains in the
  project", "… stays deleted").
- `PushConflict` (`Volt.Contracts/Wire/PushModels.cs:65-115`) has `name`, `yourVersion`, `currentVersion`, `reason`,
  `code`, `line`. Nothing structured about what was kept.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against volt's design: the all-or-nothing
decision and the "reason states what was kept" requirement of `push-keeps-what-landed`, the "caller branches on the
code, never on the prose" rule on `PushConflict.Code`, and the CLI's baseline handling of a refused op. Implement only
what fits; record what does not and the volt-native alternative, and leave it for the owner.

## What Changes

- **The conflict of a refused op says, in fields, what of it the IDE kept:**
  - `partiallyApplied: true` whenever anything of the op stays in the project (`UpdateKept`, a create that could not
    be rolled back, `Renamed`, `Replaced`); absent otherwise.
  - Where cheap: `renamedTo` (the name the item now has) and `remains: true` for a create whose rollback failed.
- `reason` keeps its wording; the fields are additive.

## Impact

- `Volt.Contracts/Wire/PushModels.cs` (`PushConflict`, additive optional fields), `Volt.Engine/Sync/PushService.cs`
  (`ConflictFor` copies from `OpOutcome`), regenerated docs.
- Clients: PLCAssist would say "re-read before retrying" only on a conflict with `partiallyApplied`, and drop that
  sentence from every other refusal.

## Volt's assessment and plan (2026-10-03)

**Observation and reading confirmed — FITS.** `PushService.OpOutcome` (`UpdateKept`, `RollbackFault`, rename,
replace) is recorded structurally and only reaches the wire as prose in `reason`; `PushConflict.Code`'s own contract
says a caller branches on the code, never on the prose. Additive fields close that gap without touching
`push-keeps-what-landed`'s all-or-nothing decision (owner, 2026-10-03: keep all-or-nothing) — they only describe what
the live IDE kept of the ONE op that stopped the push.
- Build: `partiallyApplied` (true whenever anything of the op stays), `renamedTo`, `remains` (a create whose rollback
  failed); `reason` keeps its wording. Both vendors set them identically (volt's wire-parity rule).
- The spec requirement now states SHALL (the delta did not validate before).
- Order: volt's bridge lane, after `bridge-refusal-review` (same `PushService` code).
