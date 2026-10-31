> Owner, 2026-10-31 (in Sim-Assist): "we need to retihkn the jump statement i think .. this is the part that has gotten
> complex with mutlipl options .. do you have an idea to implemen this with just 1 soltuoion instead of multlp"

DRAFT, written from Sim-Assist. FOR REVIEW (simplification). Input for `network-rail-and-pin-negation` task 1.1.

## Why

A jump or return beside a coil (CODESYS: one rung ending in a coil and a `▶ label` / `◀RETURN▶`) has three spellings or
outcomes today, chosen by what the value looks like:

1. value repeatable → the writer repeats it: `y := a AND b;` + `JMP(skip, a AND b);`
2. value holds a box or an edge → refused (`Unspellable`)
3. value reads the rung's own coil target (`a := NOT a;`) → refused (57f0eb2714)

plus the candidate wire form in `network-rail-and-pin-negation` (`w1 := v; y := w1; JMP(skip, w1);`). An editor has to
mirror all of these rules to stay round-trippable, and a user cannot predict which text a drawing gives. Sim-Assist's
editor carried the same three branches (`repeatable()`, `readsAnyOf(coils)`, wire fallback) and got two review findings
from them.

## What changes (proposal)

One spelling for every value: **a jump or return beside a coil always goes through a wire**, never a repeated value.

```
VAR_TEMP w1 : ANY; END_VAR
w1 := a AND b;
y := w1;
JMP(skip, w1);
```

- Same for `S=`/`R=` coils and for `RETURN(w1)`. The writer stops checking repeatability, edges, boxes and own-coil reads
  for this shape; the readers draw `w1` as the rung's split point (they already do for wires).
- A jump or return with no coil stays `JMP(skip, v);` / `RETURN(v);` (one statement, no wire).
- Result: one rule ("coil + control on one rung = wire"), no refusal for this shape, nothing for an editor to mirror.

Alternative considered: forbid coil + jump on one rung (jump always its own rung). Rejected for volt: CODESYS stores the
shape and drawn projects contain it, so a pull must spell it. Sim-Assist's editor will insert a jump on its own rung
until this lands, then switch to the wire form.

Triage first (volt rule): this is a usage/design question, not a bug.
