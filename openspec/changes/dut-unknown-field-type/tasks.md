> DRAFT, written from Sim-Assist. Not started.

## 1. Check

- [ ] 1.1 Resolve STRUCT and UNION field types in `computeDiagnostics`; unknown type → error on the type span

## 2. Test

- [ ] 2.1 The repro of proposal.md reports one error in `ST_Data.dut` at 4:10 and none in `Main.pou`
- [ ] 2.2 A field of a known DUT, of an FB type and of `ARRAY[..] OF <unknown>` (error on the element type)

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`)
