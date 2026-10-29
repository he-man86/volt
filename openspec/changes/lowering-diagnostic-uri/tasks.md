> DRAFT, written from Sim-Assist. Not started.

## 1. Diagnostic shape

- [ ] 1.1 `LowerDiagnostic.uri` for every lowering diagnostic (main file, library files, Standard)
- [ ] 1.2 `graphical-body` once per POU, at the POU in its own file; no `call-body` for the same cause

## 2. Test

- [ ] 2.1 The repro of proposal.md: one diagnostic, `uri` `FB_L.pou`, span inside `FB_L.pou`
- [ ] 2.2 Two instances of `FB_L`: still one diagnostic
- [ ] 2.3 A positional-call refusal inside a second POU file carries that file's `uri`

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle and removes the message parsing in `attributeLowering`
