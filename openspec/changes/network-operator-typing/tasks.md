> DRAFT, written from Sim-Assist. Measured on dev `95ead1202b`; nothing built.

## 1. EN/ENO operands

- [ ] 1.1 SEL with `EN := x` counts three operands; `ABS`, `SQRT`, `LN`, `LOG`, `EXP`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN` with `EN := x` are typed by their operand, not by `EN`
- [ ] 1.2 Tests: every operator of the table in proposal.md §1 with `EN := x`, every operand filled, has no error; the run gives the plain call's value while `EN` is TRUE

## 2. For review: network typing as ST

- [ ] 2.1 Triage §2-§4 (bug or intended): a marked output name on a non-BOOL output, `RISING`/`FALLING` on a non-BOOL value, `ADD` on BOOL in a network, an INT to `R_TRIG.CLK` in ST

## 3. Consumers

- [ ] 3.1 Sim-Assist: with a bundle that reads them, Ctrl+Shift+E offers SEL and `NO_EN_ENO` goes (its task, not Volt's)
