> FOR REVIEW (language question), written from Sim-Assist (change `network-viewer`, 2026-10-30). DRAFT: a question about network text, not a measured bug. Measured on Sim-Assist's bundle of volt dev `10ca557975`.

## Why

`network-text.html` lists `x := TRUE;` as the element **rail** (a coil fed straight from the power rail). The CODESYS
3.5.21.40 capture of the same text (Sim-Assist `openspec/changes/network-viewer/reference/ld-6-9.png`, LookLD network 8,
`skip: y := TRUE;`) shows a normally open CONTACT with the operand `TRUE` (drawn as a literal) between the rail and the coil,
not a bare rail.

```
%LANGUAGE LD
%NETWORK
skip:
y := TRUE;      // documented: rail -> (y); CODESYS draws: rail -| TRUE |- (y)
```

Why it is questionable:
- One text, two documented pictures. A coil fed straight from the rail (no contact) exists in CODESYS LD (a rung with only a
  coil); if `x := TRUE;` is the TRUE contact, that rung has no spelling, or the same spelling as the contact.
- A drawing tool cannot know which one the user placed, and a round trip may turn one into the other.

## What to review

1. What does the bridge write for a CODESYS rung with only a coil, and for a rung with a `TRUE` contact? Are they the same
   text?
2. Update the "rail" row of `network-text.html` to what CODESYS shows, or give the two pictures two spellings.
