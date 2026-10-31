> DRAFT, written from Sim-Assist. Not started.

## 1. Measure

- [ ] 1.1 Record on CODESYS 3.5.21.40 `y := a AND (x := b) AND c;` (LD and FBD) over a few scans: when `x` is written,
  what the AND box sees on its pin 2

## 2. Lower

- [ ] 2.1 Interpreter: an assignment as a non-first operand of a box input lowers (the `expr-assign_expr` refusal goes)
- [ ] 2.2 Rust emission of the same; twin parity on the recorded trace

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`); it already draws the form as an AND box
