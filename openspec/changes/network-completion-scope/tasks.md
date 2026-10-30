> DRAFT, written from Sim-Assist. Volt triages bug vs usage first.

## 1. Triage

- [ ] 1.1 Confirm with the repro in `proposal.md` (completion at network 1 lists `w1` and `???`)

## 2. Build

- [ ] 2.1 Red test: completion in network 1 of the repro has no `w1` and no `???`; in network 2 it has `w1`
- [ ] 2.2 Completion scopes a network body's wires to their network and never offers `???`
- [ ] 2.3 Tell Sim-Assist, so `network/edit/operand-completion.ts` can go
