> FOR REVIEW (language question), DRAFT, written from Sim-Assist (change `network-editor`, review round 2, 2026-10-31). A question about network text, not a measured volt bug. Measured on Sim-Assist's bundle of volt dev `10ca557975`. Volt triages bug vs usage first; nothing is built until the owner answers. Volt source is untouched.

## Why

CODESYS has a negated coil `-(/)-` (and rising/falling edge coils): Negate on a selected coil toggles the coil itself.
Network text has no spelling for it. The archived `network-text-st` design (row "negated coil", 0 / 2 / 3 in the corpus)
pulls it as `x := NOT a;`, which runs the same, but stores a negated contact on the next push (RebuildLoss), and the
edge coils likewise as `x := a;`. Both were left "open for the owner".

Measured in Sim-Assist's graphical editor (`network/edit/actions/pins.ts` `negate`): network 8 of `LookLD` holds
`y := TRUE;`. The user selects the coil `y` and presses Negation (CODESYS Ctrl+N):

```
%NETWORK
y := NOT TRUE;
```

The text parses and builds with no error, and the drawing shows a negated TRUE contact `-|/|-` before a plain coil
`( )`. CODESYS shows a plain rail into a negated coil `-(/)-`. The editor cannot draw what the user just made, because
the text cannot hold it; Sim-Assist keeps `NOT` on the value (the same as volt's pull) until this is answered.

## The question

- Current form: `y := NOT a;` (a negated contact or input, never a negated coil); edge coils are lost (`y := a;`).
- Candidate (v2's earlier spelling, from the archived design): `NOT y := a;` for a negated coil, `R_EDGE y := a;` /
  `F_EDGE y := a;` for the edge coils. Not ST, so a network body using it is no longer plain ST.
- Plain ST has no room for it: an assignment target carries no modifier and cannot be a call.
- Or decide it is not worth a spelling: the picture is rare (0 / 5 / 3 in the corpus) and runs the same as
  `y := NOT a;`. Then Sim-Assist's editor treats Negate on a coil as negating its source, as now, and says so.

What a spelling saves: the editor draws `-(/)-` after Negate on a coil, as CODESYS does, and a pull, push, pull keeps
the coil's own flag (no RebuildLoss on the 8 drawn samples).

## Open (for the owner)

- Is a negated / edge coil worth a non-ST spelling, given the owner's "every shape the IDE can store gets a spelling"
  (2026-10-30, `network-rail-and-pin-negation`), or is `y := NOT a;` the accepted reading?
