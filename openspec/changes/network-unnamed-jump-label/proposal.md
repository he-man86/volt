> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Measured, not started.

## Why

CODESYS's Insert Jump puts a jump with an empty label, drawn `???`, on the rung and lets the user name it. The text
spells every other unnamed thing the IDE stores as `???` (an operand, an instance, a coil: `??? := a;`, `x := ??? AND a;`,
`p(OUT => ???);`). A jump's label does not read:

Measured with Sim-Assist's bundle of volt dev `a292dd0f66` (`parseDocument` + `plainStText` + `computeDiagnostics`, LD):

| text | reader | diagnostics |
|---|---|---|
| `JMP.??? := RAIL();` | stray `JMP ?: a jump or a return takes :=` | `network-plain-st` (the same), `network-unnamed-target` ×2 ("Expression expected instead of '?'", "Unexpected token '?' found"), `jump-label-undefined` |
| `y := JMP.??? := c;` | the same | the same |

The receiver reader (`receivers.ts` `takeReceiverToken`) takes `JMP . <one token> :=`, but `???` lexes as three `?`
tokens, so the `:=` it looks for is a `?`. The message then names the wrong problem: the text does take `:=`.

Sim-Assist works around it without writing anything volt refuses: its Insert Jump asks for the label first and writes
`JMP.l := …` only once named, where CODESYS draws the unnamed jump at once.

## What Changes

- Read `JMP.??? := v;` (and `y := JMP.??? := v;`) as a jump whose label the IDE holds empty, as `???` is read elsewhere,
  with the `network-unnamed-target`-style diagnostic on the label alone ("a jump's label is unnamed"), so the network
  stays readable and drawable.
- The writer spells a stored jump with an empty label `JMP.???`.

## Impact

- `frontend/syntax/network/receivers.ts`, the unnamed-target check, the bridge reader/writer for parity.
- Sim-Assist: with it, Insert Jump can write `JMP.??? := …` at once and select the label for naming, as CODESYS does.
