> CLOSED 2026-10-30: not built — the two orders store two different CODESYS models and both occur in drawn projects; the text is right (verdict C, see Volt verification).

> FOR REVIEW (language question), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a question about network text, not a measured bug. Measured on Sim-Assist's bundle of volt dev `10ca557975`.

## Why

In LD, an infix `AND` whose first operand is a box and whose other operands are contacts reads as a SERIES through the box,
while the same `AND` with the box after a contact reads as an `AND` box. Swapping two operands of a commutative operator
changes the picture:

```
%LANGUAGE LD
%NETWORK
y := GT(EN := c, i, j) AND a;    // Sim-Assist (and volt's writer, StNetworkWriter.IsContact): series c -> GT -> |a| -> (y)
%NETWORK
y := a AND GT(EN := c, i, j);    // an AND box: input 1 the contact a, input 2 the GT box (CODESYS capture LookLD network 5)
```

Measured: Sim-Assist's model (built on `networkBox`, `sourceStatements`) gives `series [box GT, contact a]` for the first and
`box AND [contact a, box GT]` for the second. The second is what CODESYS 3.5.21.40 drew for LookLD network 5. The first was
not captured, so whether CODESYS writes a box in series as `box AND contact` or as something else is not known.

Why it is questionable:
- A formatter, a refactor, or a user who reorders operands for readability silently changes the drawing (and the CODESYS model
  the bridge builds), although the ST meaning is the same.
- A graphical editor that moves a contact in front of a box has to rewrite the whole expression into a different shape,
  not move one operand.
- The rule ("a box may stand first in a series, never later") is positional and stated nowhere in `network-text.html`.

## What to review

1. Is `box AND contact` really the spelling of a series through a box, and does CODESYS read it back as such (a capture of
   `y := GT(EN := c, i, j) AND a;` and of a rung `c -> GT -> a -> y` drawn in CODESYS and pulled with the bridge)?
2. If yes, should `network-text.html` state the rule, and should the network check (or a hint) flag `contact AND box`, so
   that the two pictures are never confused?

## Volt verification (2026-10-30)

**Verdict: C — Volt is right; the operand order IS the stored model's input order, not a free choice of a commutative operator.**

Measured live (CODESYS 3.5.21.40 64-bit, dev bridge on dev `5d160dd77c`, native export of the stored NWL after the push):

| pushed (LD) | stored model | pull back | re-push |
|---|---|---|---|
| `y := GT(EN := c, i, j) AND a;` | `Assign y ← AND-contact[ GT(EN=True, ENO=False)[c, i, j], a ]` | identical | fixed point |
| `y := a AND GT(EN := c, i, j);` | `Assign y ← AND-contact[ a, GT(EN=True, ENO=False)[c, i, j] ]` | identical | fixed point |

Two models, two texts: the contact AND stores its inputs in order (`InputItems`), and the text writes them in that order. Swapping
the operands changes the stored model, and CODESYS draws that model differently (the series vs the AND box Sim-Assist captured),
so the text is right to change with it. Both orders occur in DRAWN data (`test/fixtures/nwl-corpus/lenze-mid.nwl.xml`): 43
LD contact ANDs with a box first (the series through a box, e.g. a `TON`/`R_TRIG` output in series with contacts) and 1 with the
box later (AHWF network 6, pulled as `LST_General.AlwaysOff AND Alarms_V5_1_100(...)`, test-corpus `AHWF.pou:44`).

On the two questions: (1) yes, `box AND contact` is the spelling of a series through a box, and it reads back to the same model;
(2) no check or hint should flag `contact AND box`: it is a real drawn shape and the hint would fire on a customer network. No
doc rule is needed either: "a contact is AND/OR between operands" already implies the operands stand in the rung's order; at most
a viewer note on Sim-Assist's side (the order is the picture).
