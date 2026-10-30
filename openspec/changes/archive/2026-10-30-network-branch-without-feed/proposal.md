> CLOSED 2026-10-30: not built — the three spellings store three different models, all drawn in real projects; dropping FEED would merge two (verdict C).

> FOR REVIEW (simplification), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a proposal to simplify network text, not a measured bug. Nothing is built until the owner answers. Measured on Sim-Assist's bundle of volt dev `5aa22c2a09`.

## Why

One LD picture (a contact `auto`, then `a` and `b` side by side) has three accepted spellings:

```
%LANGUAGE LD
%NETWORK
x := BRANCH(FEED := auto, a, b);   // network-text.html's "parallel" row
%NETWORK
x := auto AND (a OR b);            // the contacts' own AND / OR
%NETWORK
x := auto AND BRANCH(a, b);        // BRANCH without FEED, in series
```

Measured (`parseDocument` + `computeDiagnostics` with the network checks, `sourceStatements`): all three parse to one
`assign` and report nothing. Sim-Assist's network model draws all three as the same series `auto`, then the parallel
`a | b`.

`FEED :=` is the only named parameter of a network element that is not a pin of a box. It spells a series ("this feeds
that") a second way, beside `AND`, which already is the series.

## What changes (proposed)

- Current form: `x := BRANCH(FEED := f, a, b);`
- Simpler form: `x := f AND (a OR b);` when every branch is contact-shaped, and `x := f AND BRANCH(a, g(IN := b));` only
  where a branch holds a box (where `OR` would read as an `OR` box). `BRANCH` and `BRANCH_SHORTCIRCUIT` take only their
  branches; `FEED` goes.
- The writer (`StNetworkWriter`) emits the simpler form; the reader keeps accepting `FEED :=` for one release, reported as a
  hint that names the new spelling.

What it saves:
- the viewer and editor: one shape per picture, so "insert a contact before the branch" is an `AND` operand edit, and a
  branch's feed is never a third place to look for the element in front of it;
- users: one way to read and write a parallel branch, the same `AND` / `OR` they write for contacts everywhere else.

## Open (for the owner)

1. Does the bridge's reader build the same CODESYS model for `f AND BRANCH(a, b)` as for `BRANCH(FEED := f, a, b)` (both
   vendors)? If yes, `FEED` can go.

## Volt verification (2026-10-30)

**Verdict: C — the three spellings are three different stored models; dropping `FEED` would make two of them one text (a defect).**

Measured live (CODESYS 3.5.21.40 64-bit, native export of the stored NWL after the push; each pulled back identical and re-pushed
as a fixed point):

| pushed (LD) | stored model |
|---|---|
| `x := BRANCH(FEED := auto, a, b);` | `Assign x ← Parallel(Input = auto, Trees = [a, b], Sequential)` |
| `x := auto AND (a OR b);` | `Assign x ← AND-contact[ auto, OR-contact[a, b] ]` (no Parallel at all) |
| `x := auto AND BRANCH(a, b);` | `Assign x ← AND-contact[ auto, Parallel(Input = none, Trees = [a, b]) ]` |

All three occur in DRAWN data (`nwl-corpus/lenze-mid.nwl.xml`): Parallels WITH a feed 12 (an operand 4, a wire 4, a box 4),
Parallels with NO feed standing as an operand of an AND contact 5 (e.g. Mach1_MIDS networks 24, 26, 27, 28), and nested
AND/OR contacts throughout. The IDE keeps the vendor's `BoxTreeParallel.Input` as its own member, so `FEED` is the only place the
text says "this Parallel holds its feed" as opposed to "a feed-less Parallel in series after a contact".

Answer to Open 1: no — `f AND BRANCH(a, b)` builds a different model from `BRANCH(FEED := f, a, b)`, so `FEED` cannot go. A
viewer may draw the three alike (they run alike), but an editor that rewrites one into another changes the stored network.
Also note the proposal's "keep accepting `FEED :=` for one release" would run against the standing owner rule of no
backward-compatibility periods.
