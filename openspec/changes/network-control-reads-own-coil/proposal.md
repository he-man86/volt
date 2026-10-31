> FOR REVIEW (language question), DRAFT, written from Sim-Assist (change `network-editor`, review round 3, 2026-10-31). Volt triages bug vs usage first; nothing is built until the owner answers. Volt source is untouched. Read from volt dev `9a4097ccf1` (`StNetworkWriter.AssignItem` / `Repeatable`); measured on Sim-Assist's TypeScript twin of the same rule. Related: `network-coil-beside-jump` (FOR REVIEW, simplification).

## Why

A coil beside a jump is spelled by repeating the rung's value after the coils (owner 2026-10-28):
`y := c; JMP(skip, c);`. `StNetworkWriter.Repeatable` decides whether the value may be written twice: operands,
contacts and keyword operator boxes may. It does not look at what the rung's own coils write. When the value reads a
variable a coil of the same rung writes, the second statement reads the updated variable, so the jump no longer fires on
the rung's power flow.

A CODESYS LD rung `a` NC contact into coil `a`, with a jump to `skip` beside the coil (a toggle that jumps when it turns
on). The stored model evaluates the rung once: the coil and the jump get the same value, `NOT a(old)`. The writer's rule
gives:

```
%NETWORK
a := NOT a;
JMP(skip, NOT a);
```

which jumps on `NOT a(new)` = `a(old)`: the inverse of the rung's result. The same for `x := a AND x;` (a seal-in) with a
jump or a return beside it (`JMP(skip, a AND x)` reads the new `x`), and for `S=` / `R=` coils.

Measured in Sim-Assist (`network/edit/text-edit.ts` `addControl`, same rule as the writer): Insert Jump on the coil of
`a := NOT a;` wrote `a := NOT a;\nJMP(???, NOT a);` before the fix. Sim-Assist now moves such a value into a wire
(the writer's path for a value it may not repeat):

```
%NETWORK
VAR_TEMP w1 : ANY; END_VAR
w1 := NOT a;
a := w1;
JMP(skip, w1);
```

## What changes (proposed)

- Current: `Repeatable(value)` alone; a value reading a coil target of the same item is repeated.
- Proposed: a value is not repeatable when it reads a variable that one of the item's coils writes (compare the base
  name, case-insensitive: `s.x[i]` is `s`). The writer then spells it like a box value (a wire, or whatever
  `network-coil-beside-jump` settles on). Note that `network-coil-beside-jump`'s candidate `JMP(skip, y)` (read the coil)
  is right for a `:=` coil but not for an `S=` / `R=` coil, whose variable is not the rung's value.

What it saves: a jump or return that runs as the drawn rung; the lowering (`network-text-lowering`) and the reader can
then treat every repeated value as the same value.

## Open (for the owner)

- Bug or usage: does the writer throw `Unspellable` today for such a rung, or write the repeated form? (Read from source:
  it writes the repeated form.)
- Is a wire the wanted spelling here, or is it a case for `network-coil-beside-jump`?
