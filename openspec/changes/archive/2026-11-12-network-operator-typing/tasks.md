> Written from Sim-Assist, measured on dev `95ead1202b`; built 2026-11-09 against CODESYS 3.5.21.40 recordings.

## 1. EN/ENO operands

- [x] 1.1 SEL with `EN := x` counts three operands; `ABS`, `SQRT`, `LN`, `LOG`, `EXP`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN` with `EN := x` are typed by their operand, not by `EN` — `intrinsic-operands` reads a network box as the ST call it is (`networkBox(…).st`), as `call-arguments` already did
- [x] 1.2 Tests: every operator of the table in proposal.md §1 with `EN := x`, every operand filled, has no error (`intrinsic-operands.test.ts`; recorded clean: `ng_ot_sel_en`, `ng_ot_abs_en`, `ng_ot_sqrt_en`); the run gives the plain call's value while `EN` is TRUE (`network.test.ts`, SEL and ABS)

## 2. For review: network typing as ST

- [x] 2.1 Triage §2-§4, each measured and refused by CODESYS 3.5.21.40, now refused in its words:
  - a marked output name on a non-BOOL output (`ng_ot_inverted_time_output`): "Cannot convert type 'TIME' to type 'UDINT'", "Cannot convert type 'UDINT' to type 'TIME'" — the output read as `NOT <box>.ET`
  - `RISING`/`FALLING` on a non-BOOL value (`ng_ot_rising_int`, `ng_ot_rising_word`): "Cannot convert type 'INT' to type 'BOOL'" — the value converted into R_TRIG's CLK. `AND(RISING(w), w)` also gets "Cannot convert type 'BOOL' to type 'UINT'" (an AND of a BOOL and a WORD), which the LSP does not yet say (missing, not wrong)
  - `ADD` on BOOL in a network (`ng_ot_add_bool`) and `x := a + b` in ST (`op_arithmetic_bool_plus_bool`): "Cannot convert type 'BOOL' to type 'USINT'", "Cannot convert type 'USINT' to type 'BOOL'" — two BOOLs meet at USINT; the ST rule had said "'BOOL' to type 'BOOL'"
  - an INT to `R_TRIG.CLK` in ST (`calls_r_trig_clk_int`): "Cannot convert type 'INT' to type 'BOOL'" — a library FB's named inputs are type-checked

## 3. Consumers

- [x] 3.1 Sim-Assist: with a bundle that reads them, Ctrl+Shift+E offers SEL and `NO_EN_ENO` goes (its task, not Volt's)
