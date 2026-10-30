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
