> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Measured, not started.

## Why

`network-text-one-to-one` F6 measured `y := a AND (x := b) AND c;` on CODESYS 3.5.21.40: it stores
`AND(a, Assign[x] ← b, c)`, builds, and draws a 3-input AND box with coil x branching off the b contact. The text was
kept ("Rule (revised). No refusal"), and Sim-Assist now draws it as CODESYS does (an AND box).

The lowering refuses it. Measured with Sim-Assist's bundle of volt dev `a292dd0f66` (`voltEngine.compile`, LD Main):

| text | result |
|---|---|
| `y := (x := a) AND b;` (the coil on the first operand, one rung) | runs |
| `y := a AND (x := b) AND c;` (the coil on operand 2, an AND box) | `expr-assign_expr: assign_expr is not lowered yet` |

So a network CODESYS stores, builds and draws cannot run in Sim-Assist. Sim-Assist's Insert Coil writes the mid-rung
coil on the whole signal up to the line (`(??? := a AND b) AND c`), which runs; the box form comes from a typed or pasted
text, or from a CODESYS network pulled as text.

## What Changes

- Lower an assignment that stands as a non-first operand of an AND (and any other box input) the way CODESYS runs the
  stored `Assign` node: the target takes that operand's value, and the operand hands the value on. Measure the scan order
  first (is `x` written before or after `a` is read?).
- Interpreter and Rust, with twin parity.

## Impact

- `transpile/lower` (the `assign_expr` refusal in an expression), the exec twin, Rust emission.
- Sim-Assist: no change; the run works with the next `build:volt`.
