# Structural findings

Phase 2 output, plus phase 4's deferrals. Written by the main loop; agents never append here.

Every finding cites **quoted code**, not a summary, and states `why_it_costs` as a concrete scenario — not
"cleanliness". A finding that cannot name what goes wrong is a preference, and preferences do not justify
moving code that writes to a live PLC.

Read the **testability** section first: a fake that has to lie names a misplaced seam, and that is how the
audit's single most valuable finding surfaced.

## Layering — dependencies pointing the wrong way, or skipping a layer

## Duplication — two ways to do one thing

## Placement — decisions made outside the layer that owns them

## Abstraction fit — dead flexibility, and seams that should exist and don't

## State & lifetime — caches, throttles, statics, apartment affinity

## Testability — what the fakes have to pretend

## Contract fit — wire vs domain vs workspace models

## Deferred — moves phase 4 refuted, with the objection

_Each entry: the move as proposed, which skeptics refuted it and on what grounds, and what would have to be true
for it to become viable. A deferral without a testable condition is a deletion — say so and delete it._
