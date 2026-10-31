## 1. Bug first

- [x] 1.1 Finding 1: TwinCAT unwired pin → pin left out (test-first from `Vn_ton_unwired`, offline)

## 2. Measure (live CODESYS; TwinCAT offline only)

- [ ] 2.0 XAE probe (one LD TON, IN and EN drawn on the left rail): does TwinCAT store the rail as an empty operand? If so the empty EN refused by 9589814a13 is the rail there, not "unconnected" — then read it as RAIL() (TwinCAT dialect), not refused
- [x] 2.1 Captures for findings 3, 6, 7, 8, 10, 11, 13, 15 and the census for 2; results in design.md
- [x] 2.2 Volt + Sim-Assist settle each rule; the owner sees the joint list (design.md "Decided by Volt + Sim-Assist"; F6, F7, F10, F11, F12, F15 need no Volt change)

## 3. Build

- [ ] 3.1 Writer + both readers + twin, red then green per finding; `network-text.html` updated — F2, F4, F5, F8, F9, F13, F14, F16 and the empty-name mark built; **F3 open** (design.md "Open")

## 4. Bugs found while measuring (fix test-first)

- [x] 4.1 An FB instance named `r` is refused by the reader (`r(SET := …)` does not parse; `rs1` does) — no bug: neither IDE declares `r` (design.md "Built")
- [x] 4.2 A pushed `EXECUTE(…)` with no EN stores EN null and its code never runs (0 of 99 scans) — stores false now; runs live in FB and PROGRAM
- [ ] 4.3 Pushed boxes store EN/ENO and root output lists differently from drawn ones: find out whether it is visible — EN/ENO fixed to the drawn false; the root output list is F3's, open
