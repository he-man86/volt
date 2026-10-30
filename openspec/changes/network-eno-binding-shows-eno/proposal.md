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

## Volt verification (2026-10-30)

**Verdict: D — nothing is broken; a language preference for the owner. Recommendation: keep the current rule.**

Measured live (CODESYS 3.5.21.40 64-bit, native export of the stored NWL):

| pushed (LD) | outcome |
|---|---|
| `MOVE(EN := c, 7, ENO => lamp, OUT => n).ENO;` | stored `MOVE EN=True ENO=True`, output slots `[lamp, n]`; pulled identical, fixed point |
| `MOVE(EN := c, 7, OUT => n).ENO;` | stored `MOVE EN=True ENO=True`, output slots `[null, n]`; pulled identical, fixed point |
| `MOVE(EN := c, 7, ENO => lamp, OUT => n);` | refused by the bridge too: `NETWORK_PARSE` line 3, "the call MOVE wires ENO => and shows no ENO …" |

Answer to Open 1: no vendor model has an ENO bound without ENO shown — the ENO slot exists only on a box whose `ENO` flag is
true (`Box.HasEnoSlot`), so at a root the `.ENO` beside `ENO => v` states nothing more. Drawn data has none of this shape at all:
128 root boxes show ENO in the corpora, 0 bind it to a variable (`nwl-corpus/*.nwl.xml`).

Trade-off. Today: one uniform rule, `.ENO` ⇔ "ENO shown", and `ENO => v` is a target of the shown ENO; the refusal is a
consequence of those two rules, not a special case. Proposed: `ENO => v` would ALSO state "ENO shown", so the fact gets two
markers, and `.ENO` would mean "shown" at a root without a binding and "the value handed on" elsewhere; keeping the root `.ENO`
accepted beside it (as proposed) makes two spellings of one picture and a compatibility period, against both standing owner
rules. If the owner wants the shorter form, it must be the only one (root `.ENO` beside `ENO =>` refused, writer changed, no
compat window). Recommendation: keep today's rule; the refusal message already says what to write.
