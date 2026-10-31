## Why

Owner, 2026-10-31 (relayed by Sim-Assist): the owner's LD Main does not run. The interpreter refuses every body that
jumps: `stmt-jmp` ("jmp is not lowered yet") and `stmt-label`. The IR has no jump, so neither ST `JMP`/labels nor the
network jump/return targets (`JMP.l := v`, `RETURN := v`, `y := JMP.l := v`) can run. The Rust emitter starts from the
same IR.

## What changes

- An IR jump (conditional and unconditional) and labels, lowered from ST `JMP l;` / `l:` and from network jump and
  return targets. Labels work across networks within one body, as in an ST body.
- The interpreter runs them; the Rust emitter emits them (a structured form, e.g. a label-dispatch loop: Rust has no
  goto).
- Oracles: CODESYS-recorded exec cases (ST and LD/FBD), exec-twin parity on the corpus bodies that jump, and Rust
  compiles and runs the same traces.
