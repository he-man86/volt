> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Folded into `network-language` (rule 3).

## Why

`network-text-one-to-one` F6 measured a coil on the second operand of an AND, `ASSIGN(a AND ASSIGN(b, Q => x) AND c, Q => y);`, on CODESYS 3.5.21.40: it
stores `AND(a, Assign[x] ← b, c)`, builds, and draws a 3-input AND box with coil x branching off the b contact.
Sim-Assist draws it as CODESYS does (an AND box). A network CODESYS stores, builds and draws runs in Sim-Assist only
when the lowering runs a coil that stands as an operand.

| text | |
|---|---|
| `ASSIGN(ASSIGN(a, Q => x) AND b, Q => y);` (the coil on the first operand, one rung) | a coil as an operand |
| `ASSIGN(a AND ASSIGN(b, Q => x) AND c, Q => y);` (the coil on operand 2, an AND box) | a coil as an operand |

Sim-Assist's Insert Coil writes the mid-rung coil on the whole signal up to the line (`ASSIGN(ASSIGN(a AND b, Q => ???) AND c, Q => y)`);
the box form comes from a typed or pasted text, or from a CODESYS network pulled as text.

## What Changes

- Lower an ASSIGN that stands as any operand of an AND (the doc's coil in a rung `ASSIGN(ASSIGN(a, Q => x) AND b, Q => y);`, and any other box input) the
  way CODESYS runs the stored `Assign` node: the target takes that operand's value, and the operand hands the value on.
  Measure the scan order first (is `x` written before or after `a` is read?).
- Interpreter and Rust, with twin parity.

## Impact

- `transpile/lower` (an ASSIGN in an expression), the exec twin, Rust emission.
- Sim-Assist: no change; the run works with the next `build:volt`.
