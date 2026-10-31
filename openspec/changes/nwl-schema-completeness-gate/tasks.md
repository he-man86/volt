## 1. Census

- [x] 1.1 NWL schema census from the assembly: classes, fields, flags, slots â†’ generated table
- [ ] 1.2 Import Sim-Assist's editor texts (`%TEMP%\volt-sim-assist-texts\texts.jsonl`, copied into fixtures)

## 2. Gate

- [x] 2.1 Generator (class Ã— slot Ã— flag, pairwise stacks, depth â‰¤ 2; cuts logged)
- [x] 2.2 Both-way round trip gate; every combination = one spelling or a named refusal
- [x] 2.3 Export the shapes as a versioned fixture for Sim-Assist

## 3. CODESYS

- [x] 3.1 Store/build/draw each generated class/slot/flag on live CODESYS; recordings committed
- [x] 3.2 Fix every gap the gate finds (spelling or named refusal, test-first)
