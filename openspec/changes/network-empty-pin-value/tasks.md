> DRAFT, written from Sim-Assist. Not started.

## 1. Check

- [x] 1.1 Confirm the bridge reader's refusal of `IN := ,`, `EN := ,` and an empty positional argument in a network
  (`StNetworkReader.Read` probe, dev 3bf209901e: all three `line 3: an operand at …`)
- [x] 1.2 The LSP network check refuses the same, with the same words as the bridge (a shared refuse case in
  `test/fixtures/network-text-st/refuse`); the lowering of `EN := ,` stops throwing

## 2. Doc

- [x] 2.1 `packages/volt-cli/docs/network-text.html` "Errors": the empty pin value
