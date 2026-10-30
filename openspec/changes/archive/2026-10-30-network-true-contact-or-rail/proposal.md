> CLOSED 2026-10-30: doc fixed (the row is 'TRUE contact', what a push stores); own spelling for a coil on the bare rail is an open owner question.

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

## Volt verification (2026-10-30)

**Verdict: A (the doc mis-describes what the bridge builds). Sim-Assist's capture is right. The rail↔`TRUE` collapse itself is
the approved "stored member" design, already counted; whether to keep it is the owner's call.**

Measured live (CODESYS 3.5.21.40 64-bit, native export after the push): LD `y := TRUE;` stores `Assign y ← BoxTreeOperand 'TRUE'`
— a TRUE contact, never a `BoxTreeTerminator` (the bare rail). Pulled identical, fixed point.

Q1, the bridge's text for each drawn model — the same, `TRUE`: drawn data (`nwl-corpus/lenze-mid.nwl.xml`) holds 3 coils on the
bare rail (`General`, `POU_systemStart`, `Dryer`), pulled as `LST_General.FirstCycle R= TRUE;` (test-corpus `General.pou:31`) and
`LST_General.FirstCycle S= TRUE;` (`POU_systemStart.pou:7`), and 1 coil on a drawn TRUE contact (GeneralMachineFlags network
25), pulled as `… R= True;` — the operand as typed. A contact typed `TRUE` and the rail are therefore one text. Also 4 wires and
52 box inputs on the rail, written `TRUE` the same way. This is deliberate: archived `2026-10-28-network-text-st/design.md`
"Stored members, not spelled" ("a coil, a Demux or an input pin fed by the bare rail vs `TRUE`"), and the completeness oracle's
ledger counts it ("BoxTreeAssign.RValue — node class changed": "a coil fed by the bare rail is written TRUE …, rebuilt as the
operand TRUE"; the same for `InputItems` and `Demux.Input`). Pairing keeps an unchanged network as drawn; an edited one turns
the rail into a TRUE contact (runs the same).

The defect: `network-text.html`'s elements row "rail: `x := TRUE;`" says the text builds the rail; the push builds a TRUE contact.
Fix (Q2): the row is a TRUE contact, not the rail. Owner's call (D part): keep the rail a stored member written `TRUE` (runs
the same; 3 + 4 + 52 drawn) or give the bare rail a spelling of its own (e.g. a coil with no value), which "one spelling per
picture" argues for at the cost of one more form.
