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
