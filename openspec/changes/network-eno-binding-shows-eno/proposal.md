> FOR REVIEW (simplification), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a proposal to simplify network text, not a measured bug. Nothing is built until the owner answers. Measured on Sim-Assist's bundle of volt dev `5aa22c2a09`.

## Why

A box at a network's root whose ENO runs to a variable needs its ENO stated twice:

```
%LANGUAGE LD
%NETWORK
MOVE(EN := c, 7, ENO => lamp, OUT => n).ENO;   // accepted
%NETWORK
MOVE(EN := c, 7, ENO => lamp, OUT => n);       // refused
```

Measured (`computeDiagnostics`, network checks in): the second is refused with `network-plain-st` "the call MOVE wires
ENO => and shows no ENO: ENO => v is a target of the shown ENO, which its call closed by .ENO states". At a root nothing
reads the call's value, so the closing `.ENO` says only what `ENO => lamp` already says: ENO is shown.

## What changes (proposed)

- Current form: `MOVE(EN := c, 7, ENO => lamp, OUT => n).ENO;`
- Simpler form: `MOVE(EN := c, 7, ENO => lamp, OUT => n);`: an `ENO =>` binding shows ENO. `.ENO` closes a call only where
  something reads the call's value (`lamp := MOVE(EN := c, 7, OUT => n).ENO;`, `MOVE(EN := MOVE(…).ENO, …)`).
- The writer emits the simpler form; the reader keeps accepting the root `.ENO` (it states nothing more).

What it saves:
- the viewer and editor: binding an ENO to a variable is one argument added, not an argument plus a closer that has to be
  added and removed with it; a root box has one spelling;
- users: no refusal for the obvious text, and `.ENO` means one thing (the value handed on).

## Open (for the owner)

1. Does any vendor model differ between a root box with ENO bound and one with ENO shown and bound? If not, one spelling.
