> DRAFT, written from Sim-Assist (change `network-review-fixes`, 2026-11-09). Measured, not started. Item 1 is a bug that
> blocks an editor box; items 2-4 are **for review** (the network check is laxer than ST, or than CODESYS, on the same
> operation). Owner (2026-10-29): "whenever you find bugs in volt engine please report to volt".

## Why

Sim-Assist's LD/FBD editor offers SEL through Ctrl+Shift+E (box with EN/ENO). Volt refuses every such box, even with
every operand filled, so the user gets a network that never compiles. While measuring it, the network check turned out to
accept marks and operators on types ST (and CODESYS) refuses.

Measured on volt dev `95ead1202b` (Sim-Assist's vendored bundle) with `parseDocument` + `buildSymbolTable` +
`fileDiagnostics`, a PROGRAM declaring `x, y, b, b2, ob : BOOL; i, j, oi : INT; w : WORD; et : TIME; t1 : TON;
rt : R_TRIG;`, FBD bodies as one `%NETWORK`:

### 1. EN/ENO on SEL and the unary math operators (bug)

| Text | Measured | Expected |
|---|---|---|
| `ASSIGN(SEL(EN := x, b, i, j, OUT => oi), Q => y);` | `operator-operand-count` "'SEL' needs exactly '3' operands" | no error (`oi := SEL(b, i, j);` has none) |
| `ASSIGN(ABS(EN := x, i, OUT => oi), Q => y);` | `operator-not-possible` "Operation 'Abs' is not possible on type 'BOOL'" | no error |
| `ASSIGN(SQRT(EN := x, i, OUT => olr), Q => y);` | `call-argument-type` "Cannot convert type 'BOOL' to type 'LREAL'" | no error |
| `LN`, `LOG`, `EXP`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN` with `EN := x` | `operator-not-possible` "Operation '…' is not possible on type 'BOOL'" | no error |
| `MUX`, `LIMIT`, `MOVE`, `MAX`, `MIN`, `EXPT`, `TRUNC`, `SHL`/`SHR`/`ROL`/`ROR`, `ADD`…`MOD`, `EQ`…`GE`, the conversions, `CONCAT`…`RIGHT` with `EN := x` | no error | no error |

SEL counts `EN` as one of its three operands; the unary math operators take `EN`'s BOOL as their operand's type.

### 2. A negated output name on a non-BOOL output (for review)

| Text | Measured | The same in ST |
|---|---|---|
| `ASSIGN(t1(EN := x, IN := b, PT := T#1S, ET_INVERTED => et), Q => y);` | no error | `et := NOT t1.ET;` → `unary-operand-type` "Cannot convert type 'TIME' to type 'UDINT'"; `INVERT(t1(…).ET)` in a network gets the same |

CODESYS negates BOOL connections only.

### 3. An edge on a non-BOOL value (for review)

| Text | Measured | Expected |
|---|---|---|
| `ASSIGN(RISING(i), Q => y);` | no error | refused: `RISING` is an R_TRIG on its BOOL `CLK` |
| `ASSIGN(AND(RISING(w), w), Q => w);` | no error | refused |
| ST `rt(CLK := i); y := rt.Q;` | no error | refused: INT to the BOOL input `CLK` |

### 4. ADD on BOOL in a network (for review)

| Text | Measured | The same in ST |
|---|---|---|
| `ASSIGN(ADD(b, b2), Q => ob);` | no error | `ob := b + b2;` → `binary-op-type-mismatch` |

## What Changes

- The operator check of a box read with `EN` leaves `EN` out of the operands it counts and types (SEL, the unary math
  operators), as it already does for MUX, LIMIT, MOVE and the rest.
- For review: the network check types a marked output name, `RISING`/`FALLING` and an operator box's operands as ST does
  for the same operation.

## Impact

- The network operator check and the network box typing (`analysis/checks/network`, `frontend/syntax/network`).
- Sim-Assist: its editor refuses SEL with EN/ENO (and leaves the unary math operators out of Ctrl+Shift+E) until a bundle
  reads them, then drops that refusal (`network/edit/operators.ts` `NO_EN_ENO`). Its Negate and Edge commands refuse
  non-BOOL connections, so items 2-4 are reachable only from typed text.
