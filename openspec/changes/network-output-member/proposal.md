> Owner, 2026-10-28: "even FBs have 1 output pin that can chain right … you can move the output pin … what if we do the
> same for the other blocks? like .ENO … good implement". Follows the archived network-text-st.

## Why

network-text-st spells a box as a call whose return value is the line to the next box, but needs three suffixes
(`_EN`, `_ENO`, `_ENONLY`) to say which output that is, writes an FB box as a statement plus a `Q => w` wire, and
puts a suffix on an FB instance (`t1_EN`). The rule "a call returns its chaining output" does not hold for an FB: the
engineer can move the output pin, and NWL stores the chaining output by name (`MainOutputName`). Measured on the
CODESYS corpora (2026-10-28): of 101 consumed FB boxes, 91 chain the first declared output, 2 the second (Lenze
`L_FECA` blocks, `xErrorActive`), 8 chain ENO (`ServoControl`, 7× `LIN_TRAFO`); the TwinCAT archives add 2 consumed
`TON`s, both chaining `Q`.

## What changes

One rule for every box: **the call is the box; `.NAME` names the output that chains on, where the box has more than
one output that can.**

```
x    := GT(a, b);                                                    // one output: nothing to name
x    := GT(EN := c, a, b);                                           // EN shown, no ENO: one output (DIALECT N16)
done := MOVE(EN := MOVE(EN := c, 1, OUT => x).ENO, 2, OUT => y).ENO; // ENO→EN chain
x    := AND(TON(FB := t1, IN := a, PT := T#1S).Q, b);                // an FB: Q chains
t    := TON(FB := t1, IN := a, PT := T#1S).ET;                       // moved pin: ET chains
```

- One function name per box, as in the toolbox; `EN :=` present = EN shown. The suffixes `_EN`, `_ENO`, `_ENONLY` go.
- An FB box is a call of its type with its instance as the `FB :=` pin; its outputs `X => v`, its chaining output
  `.X`. The FB call statement form, `Q => w` wires for a box read once, and `t1_EN` go.
- Other outputs stay `NAME => target`; the value of a box with ENO is `OUT`.
- The LSP knows one signature per box; the type of `.X` is the declared output's.
- 1:1 with NWL: `EN :=` and `.ENO` are the box's EN/ENO flags, an FB's `.NAME` its stored connected output (`MainOutputName`); `.OUT` is Volt's name for a function's value (NWL stores no `OUT`), and a root's `.ENO` states the flag, no connection.
