> DRAFT, written from Sim-Assist (change `network-editor`, review round 1, 2026-10-30). Measured on Sim-Assist's bundle of volt dev `10ca557975` (`services` completion, `packages/volt-lsp-iec/src/services/assist/completion.ts`). Volt triages bug vs usage first; volt source is untouched.

## Why

In network text a wire is scoped to its network: it is declared `: ANY` on that network's one `VAR_TEMP … END_VAR`
line (`network-text.html`), and `???` is the placeholder for an operand nobody has named yet (volt
`network-unnamed-operand`), not a variable. Completion does not know either: it lists every network's wires and the
placeholder as POU variables, wherever the cursor stands.

Measured repro (an FB `Snip` with `a, b, c, x, y, out : BOOL; i, j : INT;`):

```
%LANGUAGE FBD
%NETWORK
out := AND(a, NOT(b), c);
%NETWORK
VAR_TEMP w1 : ANY; END_VAR
w1 := GT(i, j);
x := AND(w1, a);
y := w1;
%NETWORK
??? := AND(???, b);
```

Completion at the first operand of network 1 (`AND(|a, …`) returns, first:

```
w1   variable        <- declared on network 2's VAR_TEMP line only
???  variable        <- the placeholder of network 3
a    variable BOOL
b    variable BOOL
…
```

Picking `w1` writes `AND(a, NOT(b), c, w1)` in network 1, a read of a wire that network does not declare.

Sim-Assist workaround: `network/edit/operand-completion.ts` (`networkCompletion`) drops other networks' wires and `???`
from the items before showing them; it points at this draft and goes when completion is network-aware.

## What changes

- Completion inside a network body lists the wires declared on that network's `VAR_TEMP` line and no other network's.
- `???` is never offered as a completion item.

## Impact

- `packages/volt-lsp-iec/src/services/assist/completion.ts` (scope of a network body's wires; the placeholder).
- Every editor of network text (Sim-Assist's LD/FBD editor, the VS Code extension) gets the right list without a filter.
