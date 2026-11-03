> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Measured, not started.
> Checked on dev 3bf209901e (2026-11-03): still real (`boxes.ts:66-67`, `network.ts:56`), spellings current. Added below: a jump's edge (`RISING JMP.l := a;`, in the doc's Marks table) is refused the same way (`network.ts:346`). `network.test.ts` "an edge mark on a pin and a mark on an output are unmeasured" pins the refusals and flips with this work.

## Why

`network-rail-and-pin-negation` gave every CODESYS mark a spelling, and the readers take them all. The lowering
(interpreter and Rust) still refuses these by name, as "unmeasured":

- an edge on a pin or on EN: `t1(RISING IN := a, PT := T#1S);`, `MOVE(RISING EN := c, 1, OUT => n);`
  → `network-box: the edge mark on the pin IN: how an edge on a pin runs is unmeasured`;
- a mark on a bound output: `t1(IN := a, PT := T#1S, NOT Q => x);`
  → `network-box: the mark on the output Q: how a marked output runs is unmeasured`;
- an edge on a jump: `RISING JMP.l := a;`
  → `network-box: the edge mark on the jump JMP.l: how a jump's edge runs is unmeasured`.

Sim-Assist's network editor writes these forms: Ctrl+E on a BOOL input or EN pin cycles the receiver edge, Alt+N on a
bound output writes `NOT Q => x` (CODESYS's own commands; volt measured that each stores, builds and draws). A program
that holds one fails at Start with the refusal. That is correct while the run is unmeasured, but it means an IDE model
cannot run in Sim-Assist.

Measured with Sim-Assist's bundle of volt dev `a292dd0f66` (`voltEngine.compile`, LD Main, `t1 : TON`):

| text | result |
|---|---|
| `t1(NOT IN := a, PT := T#1S);` | runs |
| `MOVE(NOT EN := c, 1, OUT => n);` | runs |
| `t1(RISING IN := a, PT := T#1S);` | refused (pin edge) |
| `MOVE(RISING EN := c, 1, OUT => n);` | refused (pin edge) |
| `t1(IN := a, PT := T#1S, NOT Q => x);` | refused (output mark) |
| `NOT y := a;`, `RISING y := a;`, `RISING NOT y := a;` | run |
| `y := NOT t1(IN := a, PT := T#1S).Q;`, `y := RISING(t1(…).Q);` | run |

## What Changes

- Measure on CODESYS 3.5.21.40 how a pin edge (IN, EN, an operator pin, `AND(a, RISING := b)`), a jump's edge and a marked output (NOT, RISING, FALLING on
  `Q => x`) run: when the edge detector is evaluated, whether the output mark negates the variable written or the value
  handed on, scan by scan (record:exec / record-exec-network cases).
- Lower them as measured, in the interpreter and in Rust, with twin parity; the refusals go.

## Impact

- `transpile/lower/network/*` (the `network-box` refusals), the exec twin, Rust emission.
- Sim-Assist: no change; its editor already writes these forms, and its run starts working with the next `build:volt`.
