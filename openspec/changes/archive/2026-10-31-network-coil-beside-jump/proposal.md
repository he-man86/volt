> CLOSED 2026-10-31, unbuilt (Volt triage): Volt's writer does not write the wire form this draft measured (that is Sim-Assist's editor); it refuses the shape by name. `JMP(skip, y)` is wrong for `S=`/`R=` coils. The missing spelling moves into `network-rail-and-pin-negation`.

> FOR REVIEW (simplification), written from Sim-Assist (change `network-editor`, 2026-10-30). DRAFT: a proposal to simplify network text, not a measured bug. Nothing is built until the owner answers. Measured on Sim-Assist's bundle of volt dev `abb1b41f53`.

## Why

A coil beside a jump (CODESYS: Insert Jump on a rung that ends in a coil keeps the coil) is spelled by repeating the
rung's value (owner 2026-10-28, `StNetworkWriter.AssignItem`):

```
%NETWORK
y := c;
JMP(skip, c);
```

When the value may not be written twice (a box, an edge, an FB call), it first moves into a wire. Measured in
Sim-Assist's editor (`network/edit/text-edit.ts` `addControl`, test "a value that may not be repeated moves into a wire"):

```
%NETWORK
VAR_TEMP w1 : ANY; END_VAR
w1 := TON(IN := c).Q;
y := w1;
JMP(skip, w1);
```

One picture element (the jump beside the coil) costs a wire declaration, a definition and two reads. Deleting the coil
then has to inline the wire again (Sim-Assist `releaseWire`). Both spellings parse with no error and draw the same picture.

## What changes (proposed)

- Current form: `y := c; JMP(skip, c);`, and with a wire for any value volt may not repeat.
- Simpler form (candidate): keep two statements but let the control read the coil, `y := c; JMP(skip, y);`. A coil target is an operand, so it is always repeatable and no wire is ever needed.
- The owner picks; the reader keeps the current form for one release.

What it saves:
- the editor: Insert Jump / Insert Return beside coils is one insertion, never a wire;
- users: a rung reads as one statement; no `w1` appears for a jump.

## Open (for the owner)

- Is `JMP(skip, y)` (reading the coil's variable after the assignment) the same model CODESYS stores? It is the same value
  in the same scan, but CODESYS stores the jump on the rung, not on `y`.
