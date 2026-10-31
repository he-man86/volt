## 1. Bug first

- [x] 1.1 Finding 1: TwinCAT unwired pin → pin left out (test-first from `Vn_ton_unwired`, offline)

## 2. Measure (live CODESYS; TwinCAT offline only)

- [ ] 2.0 XAE probe (one LD TON, IN and EN drawn on the left rail): does TwinCAT store the rail as an empty operand? If so the empty EN refused by 9589814a13 is the rail there, not "unconnected" — then read it as RAIL() (TwinCAT dialect), not refused
- [ ] 2.1 Captures for findings 3, 6, 7, 8, 10, 11, 13, 15 and the census for 2; results in design.md
- [ ] 2.2 Volt + Sim-Assist settle each rule; the owner sees the joint list

## 3. Build

- [ ] 3.1 Writer + both readers + twin, red then green per finding; `network-text.html` updated

## 4. Bugs found while measuring (fix test-first)

- [ ] 4.1 An FB instance named `r` is refused by the reader (`r(SET := …)` does not parse; `rs1` does)
- [ ] 4.2 A pushed `EXECUTE(…)` with no EN stores EN null and its code never runs (0 of 99 scans)
- [ ] 4.3 Pushed boxes store EN/ENO and root output lists differently from drawn ones: find out whether it is visible
