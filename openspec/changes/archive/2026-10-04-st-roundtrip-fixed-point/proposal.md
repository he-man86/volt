## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our tool census observed, and
our reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**The text a client pushes is not the text it reads back, so an edit built from the pushed text misses.** After a
create, a client that patches its own text (search/replace) instead of re-reading fails with a search that does not
match.

Recorded by the PLCAssist tool census, 2026-10-03, CODESYS 3.5.21.40, next bridge on volt `457b6a700b`:

- W1 creates an FB whose text ends `xRunning := xEnable;\nEND_FUNCTION_BLOCK`, followed by a PROPERTY, then an ACTION.
- R14 reads it back as `xRunning := xEnable;\n\nEND_FUNCTION_BLOCK` (a blank line inserted before `END_*`) with the
  ACTION before the PROPERTY.
- A patch whose search spans the end of the body, or a member boundary, as written in the create, then fails
  (PLCAssist's `PATCH_NOT_APPLICABLE`). The model has to re-read an item it wrote one step earlier.

What the code shows (volt `457b6a700b`):
- `StWriter.Write` joins the body and the END line with a blank line (`Volt.Engine/Format/St/StWriter.cs:58`, `:62`);
  the reader drops exactly that one blank line on the way in (`:32-33`). So push → fetch adds one line that the client
  never wrote, and fetch → push → fetch is stable.
- Members are written sorted by kind, then by name (`StWriter.cs:50-53`, `KindOrder` `:101-107`: METHOD, ACTION,
  PROPERTY), deliberately: "a sort only has to be the SAME sort on every pull" (`:42-49`), so a workspace diff never
  moves members around.

So the read-back shape is volt's canonical form, and the pushed shape is not normalised to it in the answer.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. The canonical member order is a stated design choice
(stable workspace diffs), and the blank line is part of it. Check the request against that first; keeping pushed
order would likely conflict, and if so do not build it. Record why and prefer the volt-native alternative below,
which gives a client the same thing without changing the canonical form. Leave the choice to the owner.

## What Changes

Either, whichever fits volt's design:

- (A) **The push receipt returns the stored text of each item it changed**, in the canonical form a fetch would give
  (e.g. `newSources: { name: text }`, or a flag on the push request that asks for it). A client then holds exactly
  what a read would give, with the version the receipt already carries, and needs no re-read.
- (B) **push → fetch is a fixed point** for ST text: no blank line added before `END_*`, members kept in pushed
  order. Only if it does not break stable workspace diffs.

(A) is the one expected to fit; (B) is listed because it is what the census measured.

## Impact

- (A) `Volt.Contracts/Wire/PushModels.cs` (`PushResponse`, additive), `Volt.Engine/Sync/PushService.cs` (render the
  changed items through the same `StWriter` the fetch uses, after the receipt walk), regenerated docs. Cost: one
  read per changed item, which the receipt walk may already hold.
- (B) `StWriter` / `StReader`, every workspace (a one-time diff).
- Clients: PLCAssist would keep the receipt's text as the model's latest read of the item, so a follow-up patch
  matches.

## Volt's assessment and plan (2026-10-03)

**Observation and reading confirmed.** The read-back shape is volt's canonical form (`StWriter.cs`: one blank line
before the END line, members sorted METHOD, ACTION, PROPERTY then by name), chosen so workspace diffs never move
members around; fetch → push → fetch is stable.
- **(B) does not fit** — keeping the pushed order/spacing would break stable workspace diffs. Not built.
- **(A) fits:** the push answer can carry the stored text of each item it changed, rendered by the same `StWriter`
  a fetch uses, so a client holds exactly what a read would give without a second call. Because it makes the answer
  larger, it is opt-in: a request flag (e.g. `returnSources: true`); without it the answer is unchanged. Both vendors
  identical.
- Order: volt's bridge lane, after `bridge-refusal-review` (same push code).
