> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Folded into `network-language` (rule 6).

## Why

CODESYS's Insert Jump puts a jump with an empty label, drawn `???`, on the rung and lets the user name it. The text
spells every other unnamed thing the IDE stores as `???` (an operand, an instance, a coil: `ASSIGN(a, Q => ???);`,
`ASSIGN(??? AND a, Q => x);`, `p(OUT => ???);`). A jump's label is spelled the same way: `ASSIGN(RAIL(), Q => JMP.???);`,
`ASSIGN(c, Q => y, Q => JMP.???);`.

## What Changes

- Read `ASSIGN(v, Q => JMP.???)` as a jump whose label the IDE holds empty, as `???` is read elsewhere, with one
  diagnostic on the label alone (C0007 "Expression expected instead of '?'"), so the network stays readable and drawable.
- The writer spells a stored jump with an empty label `JMP.???`.

## Impact

- `frontend/syntax/network/receivers.ts`, the unnamed-target check, `StNetworkWriter.cs` (the jump with no label).
- Sim-Assist: Insert Jump can write `ASSIGN(…, Q => JMP.???)` at once and select the label for naming, as CODESYS does.
