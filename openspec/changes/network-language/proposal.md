> DECIDED by the owner with Sim-Assist (ide-model-mapping 5.1, 2026-11-06); being built. Every rule cites the map rows it
> rests on: `packages/volt-cli/test/fixtures/nwl-schema/map.3.5.21.40.json` (1963 rows, CODESYS 3.5.21.40), `fixture` =
> `<recording>#<state ids>`.

## Why

The map is complete: every NWL class and option has a row. What the editor can draw and today has no text is 43 rows
(`refused-gap`, source `editor`). This language gives each of them a text and changes nothing else, so the coverage rule
holds: everything the editor can draw has a text, everything else is refused by name.

## The language

The text is the stored NWL tree as ST calls. Each stored node is one call with its parts inside `()`; the flow is each
call's return.

| # | Rule | Example | Rows |
|---|---|---|---|
| 1 | A mark on a value is a function, nested in run order. `INVERT`, not `NOT` (`NOT(a)` stays the NOT box). | `IN := RISING(a)`, `EN := INVERT(c)`, `RISING(INVERT(a))` | box-states#0581,0587; the 33 `an edge stacked on a negation` rows, e.g. assign-states#0205,0206 |
| 2 | A mark on a receiver is in its output name. An edge on a receiver is refused (the editor cannot draw it). | `Q_INVERTED => x`, `Q_SET => x`, `Q1_RESET => k` | assign-states#0029–0032; `a coil flag on a pin` assign-states#0153–0156 |
| 3 | Every coil, jump and return is `ASSIGN`, one target too. Parallel coils are one call with a list, series coils nest, a coil in a rung is a box input. | `ASSIGN(a, Q => y)`, `ASSIGN(a, Q_INVERTED => x, Q => y)`, `ASSIGN(ASSIGN(a, Q => x), Q => y)`, `ASSIGN(AND(ASSIGN(a, Q => x), b), Q => y)`, `ASSIGN(a, Q => JMP.l)`, `ASSIGN(a, Q => RETURN)` | assign-states#0241,0242, #0245,0246, #0097,0098, #0117,0118; `a marked coil inside a chain` #0251,0252, #0265,0266 |
| 4 | A box's default output flows on: ENO whenever EN is shown (any box, whatever its outputs are named); with no EN, a function's value or an FB's or program's first output. A dot only when another output flows on. | `x := GT(a, b);`, `y := GT(EN := c, a, b, OUT => v);`, `x := t1(IN := a).Q2;` | box-states#0153,0169 and the box map's `spelled` rows |
| 5 | A contactless coil value is `RAIL()` (it runs always TRUE). | `ASSIGN(RAIL(), Q => y)` | assign-states#0299 |
| 6 | An empty operand is written bare, as the editor shows it; the build gives CODESYS's own error. | `t2(a := a, q1 => ???)`, `ASSIGN(a, Q => JMP.???)` | box-states#0047,0077 |
| 7 | A function call whose flow ends is a statement. | `GT(EN := go, i, j);` | box map, `en=True eno=False, GT` |
| 8 | Kept as today: wires (`VAR w1 : ANY;`), `BRANCH()`, `BRANCH_SHORTCIRCUIT()`, `EXECUTE()`, `OPERAND()`, the `%` lines. | `y := BRANCH_SHORTCIRCUIT(FEED := a, b, c);` | class-states#0106,0107, box-states#1067 |
| 9 | A POU or variable named `INVERT`, `RISING`, `FALLING` or `ASSIGN` is refused by name. A marked output name is refused only where it is ambiguous: a box declaring both `Q` and `Q_SET` (likewise `_RESET`, `_INVERTED`); the error names this rule. `ASSIGN`'s own outputs never collide. | | none: a name rule, pinned by a test |

What runs as what (each a measured run): `INVERT` on an INT is the bitwise NOT; a mark on one coil of several acts on that
coil only; stacked marks run innermost first (CODESYS's code for a full stack: `NOT(NOT(R_TRIG(R_TRIG(a))))`).

## What changes in today's text

| Today | Becomes |
|---|---|
| `y := a;`, `y S= a;`, `y R= a;` | `ASSIGN(a, Q => y);`, `ASSIGN(a, Q_SET => y);`, `ASSIGN(a, Q_RESET => y);` |
| `x := y := a;`, `y := (x := a);` | `ASSIGN(a, Q => x, Q => y);`, `ASSIGN(ASSIGN(a, Q => x), Q => y);` |
| `JMP.l := a;`, `RETURN := a;` | `ASSIGN(a, Q => JMP.l);`, `ASSIGN(a, Q => RETURN);` |
| `y := RAIL();` | `ASSIGN(RAIL(), Q => y);` |
| `NOT`/`RISING`/`FALLING` written as words in front of a pin or value | `INVERT(…)`, `RISING(…)`, `FALLING(…)` |
| `t2(EN := go, …).ENO;` | `t2(EN := go, …);` (ENO is the default flow) |

## Stays refused, by name

- Everything the editor cannot draw (`source: created` with no text: 226 `refused-gap`, 375 `refused-fault` rows), and the
  273 census options no measured state stores.
- IL: 6 editor rows (IL edits) stay `%LANGUAGE IL UNSUPPORTED`, as IL is unsupported product-wide.
- 2 editor rows the IDE itself cannot build (a program or FB with no outputs read as a value, box-states#0317,0325,
  #0344,0350) stay refused (owner, 2026-11-06; unlike `???`, no user fills them in later).

The network text only ever lives in an LD or FBD body. Converting a POU to ST is CODESYS's own command and gives plain
ST, so `ASSIGN`, `INVERT`, `RAIL()` and `BRANCH()` never reach an ST POU.

## Folded in

The four open drafts are built as part of this change and closed with it: `network-lower-coil-in-and-box` (rule 3),
`network-lower-pin-edges-and-output-marks` (rules 1–2), `network-unnamed-jump-label` (rule 6), and
`network-function-formal-pins` (named pins are already plain call syntax; the lowering stops refusing them).

## Not in this change

Operand comments (parked by the owner). TwinCAT (ide-model-mapping 6).
