> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Folded into `network-language` (rules 1–2).

## Why

Every CODESYS mark has a spelling, and the readers take them all. The lowering (interpreter and Rust) runs a mark on a
value; these need a measured run:

- an edge on a pin or on EN: `t1(IN := RISING(a), PT := T#1S);`, `MOVE(EN := RISING(c), 1, OUT => n);`;
- a mark on a bound output: `t1(IN := a, PT := T#1S, Q_INVERTED => x);`;
- an edge on a jump: `ASSIGN(RISING(a), Q => JMP.l);`.

Sim-Assist's network editor writes these forms: Ctrl+E on a BOOL input or EN pin cycles the receiver edge, Alt+N on a
bound output writes `Q_INVERTED => x` (CODESYS's own commands; volt measured that each stores, builds and draws). A
program that holds one runs in Sim-Assist only when the lowering runs it.

| text | |
|---|---|
| `t1(IN := INVERT(a), PT := T#1S);` | a mark on a pin |
| `MOVE(EN := INVERT(c), 1, OUT => n);` | a mark on EN |
| `t1(IN := RISING(a), PT := T#1S);` | an edge on a pin |
| `MOVE(EN := RISING(c), 1, OUT => n);` | an edge on EN |
| `t1(IN := a, PT := T#1S, Q_INVERTED => x);` | a mark on an output |
| `ASSIGN(a, Q_INVERTED => y);` | a negated coil |
| `ASSIGN(INVERT(t1(IN := a, PT := T#1S)), Q => y);`, `ASSIGN(RISING(t1(…)), Q => y);` | a mark on a box read |

## What Changes

- Measure on CODESYS 3.5.21.40 how a pin edge (IN, EN, an operator pin, `AND(a, RISING(b))`), a jump's edge and a
  marked output (`Q_INVERTED => x`) run: when the edge detector is evaluated, whether the output mark negates the
  variable written or the value handed on, scan by scan (record:exec / record-exec-network cases).
- Lower them as measured, in the interpreter and in Rust, with twin parity.

## Impact

- `transpile/lower/network/*`, the exec twin, Rust emission.
- Sim-Assist: no change; its editor already writes these forms, and its run starts working with the next `build:volt`.
