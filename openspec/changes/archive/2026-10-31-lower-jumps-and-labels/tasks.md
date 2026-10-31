## 1. Build

- [x] 1.1 IR jump + label; interpreter runs them (ST `JMP`/labels first), red then green on recorded exec cases
- [x] 1.2 Network targets `JMP.l := v`, `RETURN := v`, `y := JMP.l := v`, labels across networks; twin parity
- [x] 1.3 Rust emission of the same IR; compiles and replays the recorded traces
- [x] 1.4 Consumers: Sim-Assist regenerates its bundle and runs the owner's LD Main — handed to Sim-Assist (2026-10-31)

## Close-out (2026-10-31)

- IR: `labeled` (a body cut at each label a JMP names) and `jump` (to a segment); a conditional jump is an IF holding one.
  A JMP to a label inside a block is refused by name (`stmt-jmp`) — `flw_jmp_into_loop` (a JMP into a FOR body, which
  CODESYS runs) stays not lowered.
- Recorded on CODESYS 3.5.21.40: `tr_jmp_forward_skip`, `tr_jmp_backward_counter_loop`, `tr_jmp_out_of_loop_to_later_label`,
  `tr_return_midway` (record:exec); `nt_jmp_over_network`, `nt_coil_written_before_jump`, `nt_return_on_value`
  (record-exec-network). Every value as inferred: a jump passes the statements/networks to its label, the coil beside a
  jump is written before it, RETURN := TRUE ends the scan.
- Rust: a labeled body is `'jump_N: loop { match __segment_N { … } }` (one segment: the loop alone); no `unsafe`.
