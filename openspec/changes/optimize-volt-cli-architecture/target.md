# Target architecture and the ordered move list

Phase 3 output — the synthesized winner of three independent candidates, plus the moves that reach it.
**This is the document the user reads at the phase-3 checkpoint**, before a single file moves.

## The target shape

_(projects, the layer stack, each seam and what it earns. An area whose answer is "the current shape is right"
says so explicitly — a design phase that cannot conclude *no change* will invent work.)_

## What it closes

_(mapped back to `findings.md` — which findings this shape removes, and which it deliberately leaves standing.)_

## LOC delta

Baseline: **15,295 LOC / 118 files / 7 projects.** Target: _TBD_.

> If the target is **net-additive**, the justification goes here, in as many words. An architecture phase is
> structurally biased toward adding structure; that bias is checked here or nowhere.

## The moves

Ordered bottom-up by dependency (`Transport` → `Engine` → IDE hosts → `Cli` → `Connector.Core` → `Connector`),
cross-project moves last. Every move must build and pass all three C# suites **on its own** — a move that only
works as part of a batch gets decomposed until it stands alone, or deferred.

| # | move | files | blast radius | closes | gate | status |
|---|---|---|---|---|---|---|

### Move detail

_(per move: what it does, why, the objections that survived phase 4, and the one thing most likely to go wrong.)_
