> FOR REVIEW (language question), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a question about network text, not a measured bug. Measured on Sim-Assist's bundle of volt dev `10ca557975`.

## Why

`NOT x` as a box argument has two pictures that the text cannot tell apart, and which one is meant depends on the declared
type of the pin:

```
%LANGUAGE LD
%NETWORK
q := t1(IN := NOT a, PT := T#1S).Q;   // LD, IN is BOOL (the rung pin): a negated contact |/| a feeding IN
%NETWORK
t1(IN := a, PT := T#1S);              // with IN negated on the box (CODESYS: "Negate" on the pin) -> ?
```

`network-text.html` lists `t1(IN := NOT a, PT := T#1S);` as the **negated pin**. In LD, CODESYS places a contact on a box's
Boolean rung pin, so a negated contact `a` feeding `IN` is a common picture, and its natural text is the same
`IN := NOT a`. Sim-Assist draws the LD rung pin as a negated contact (design: "LD at a Boolean rung pin: a negated
contact"), and every other `NOT x` argument as a pin negation; the choice needs the pin's declared type.

Why it is questionable:
- In LD, "negated contact on IN" and "contact on a negated IN" are two different CODESYS models with one text; a push of
  either and a pull back can swap them.
- The reading depends on type resolution (is the first pin BOOL?), so a box whose callee is not resolvable draws
  differently.

## What to review

1. What does the bridge write for each of the two CODESYS models (negated contact on IN; contact on negated IN)?
2. If they are the same text, should one of them get its own spelling (for example the pin negation written on the pin
   side), so the picture round-trips?

## Volt verification (2026-10-30)

**Verdict: A (the doc mis-describes what the bridge builds). The two-models-one-text collapse itself is the approved
"stored member" design, already counted; whether to keep it is the owner's call.**

Measured live (CODESYS 3.5.21.40 64-bit, native export of the stored NWL after the push):

| pushed | stored model |
|---|---|
| LD `t1(IN := NOT a, PT := T#1S);` | `TON` box, `InputFlags` null, `IN` ← operand `a` with `Flags = Negation` (a negated contact) |
| FBD `t1(IN := NOT a, PT := T#1S);` | the same: operand `a` negated, no pin negation |

Both pulled back identical and re-pushed as fixed points. So `IN := NOT a` ALWAYS builds the negated operand (in LD the negated
contact on `IN`), whatever the pin's type; no reading depends on type resolution, and Sim-Assist's type-based rule is not needed.

What the bridge writes for each model (Q1): the same text. A pin negated on the box (`BoxTreeBox.InputFlags` Negation) is written
`NOT x` on its value (`StNetworkWriter.PinValue`), and a rebuild turns it into the negated operand. This is deliberate:
archived `2026-10-28-network-text-st/design.md` "Stored members, not spelled" ("a negated pin … vs a negated leaf … `NOT a` reads
back as a negated leaf"), and the completeness oracle's ledger counts it ("Flags.Flags in BoxTreeOperand.Operand.Flags —
changed", 3 networks / 6 pins: "a negated pin … rebuilt as the negated operand, the pin's flag cleared"). Pairing keeps an unchanged
network as drawn; an edited one loses the pin negation (RebuildLoss names `InputFlags`).

Drawn data (`nwl-corpus/*.nwl.xml`): LD holds 11 box pins fed by a negated operand and 0 negated pins; FBD holds 6 negated pins
(lenze FirstErrorCapture) and 0 negated operands on a pin. So the collision does not occur within one language in real data, but
the FBD pins are rebuilt into the other model on edit.

The defect: `network-text.html`'s elements row "negated pin: `t1(IN := NOT a, PT := T#1S);`" names a picture the push does not
build. Fix: the row is the negated operand (a negated contact in LD) — e.g. rename it "negated input". Owner's call (D part): keep
the pin negation a stored member (runs the same; 6 drawn pins), or give it its own spelling, which "one spelling per picture"
argues for; the standing owner decision set it as a stored member on 2026-10-28.
