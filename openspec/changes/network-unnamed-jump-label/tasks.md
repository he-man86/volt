> Folded into `network-language` (rule 6) and built there (2026-11-06): the spelling is `ASSIGN(a, Q => JMP.???)`. The LSP half (2.1) is done; 2.2 is the bridge writer's (the C# lane of network-language).

## 1. Measure

- [ ] 1.1 On CODESYS 3.5.21.40: what an inserted, unnamed jump stores (an empty label? `???`?) and what it builds

## 2. Read and write

- [x] 2.1 The receiver reader takes `JMP.???` as a jump target with an unnamed label; one diagnostic on the label (C0007 "Expression expected instead of '?'" on the `???`, no `jump-label-undefined`)
- [ ] 2.2 The writer spells an empty stored label `JMP.???` (today `Unspellable`, `StNetworkWriter.cs:487`); the bridge reader already takes it (probe, dev 3bf209901e); round-trip test

## 3. Consumers

- [ ] 3.1 Sim-Assist: Insert Jump writes `JMP.??? := …` and selects the label (its follow-up, not Volt's)
