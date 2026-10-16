# Awkward-shapes sweep — measured 2026-10-16, CODESYS 3.5.21.40 (TwinCAT not measured)

Owner rule (tasks 2R.5): if CODESYS stores a network and it RUNS, Volt encodes and decodes it; how the editor draws it
does not decide. 36 cases, made by Volt push (V2 text), native-archive edit (`export_native` → edit NWL →
`import_native`) or PLCopen import; runs by a headless SP21 batch runscript (fresh online simulation per case).
Lab: session scratchpad `awkward\lab\` (cases*.json + results, exports\, nwl.py); demo project AwkwardShapesLab.
Spellings below are the sweep's proposals, written against the pre-simplification rules — 2R.5 re-spells each under
the current readability.md (e.g. #33 is already solved by `feed BRANCH (a, b)`).

S = stores, B = builds 0 errors, R = runs correctly.

| # | case | design | measured | verdict | proposed |
|---|---|---|---|---|---|
| 1 | AND fed by two ENOs | was X, now P3 | S B R (x = c∧d, 4 combos); edited rebuild builds | SPELL (done: P3) | `MOVE 1 => A EN c` / `MOVE 2 => B EN d` / `x := ENO AND ENO;` |
| 2 | one-branch parallel | X | S; B ✗ C0023 | REFUSE | — |
| 3 | 3-input SUB | X (C3) | S; B ✗ C0022 | REFUSE | — |
| 3b | 3-input XOR | B1 allows | S B R (parity) | fine | — |
| 4 | 1-input AND / ADD | P5 call form | B ✗ C0023 | REFUSE | — |
| 5 | BoxTreeMux | X | not makeable (class guid b8388f1e…: VarId, InputIndex, Merger) | UNMEASURED | — |
| 6a | negated Terminator | X | S B; flag has no effect; pull `UNSUPPORTED "a flag on an empty slot"` | SPELL (low value) | `x := NOT ;` |
| 6b | Terminator with an Input | X | import + build crashed CODESYS (stack overflow) | REFUSE | — |
| 7 | Connectors | X | PLCopen import drops them | UNMEASURED | — |
| 8 | IL lines | X | not makeable | UNMEASURED | — |
| 9 | coil + jump, one rung | refused | S B R (coil set, jump taken); pull UNSUPPORTED | SPELL | `x1 := JMP Done := c;` |
| 10 | coil + RETURN | refused | S B R | SPELL | `x1 := RETURN := c;` |
| 11 | two jumps, one rung | refused | S B R (first wins) | SPELL | `JMP L1 := JMP L2 := c;` |
| 12 | `JMP l S= c` | refused | S B; Set inert (no latch) | SPELL | `JMP Done S= c;` |
| 13 | negated coil | none | S B R (xn = NOT c); pull UNSUPPORTED "negated coil" | SPELL | `NOT xn := c;` |
| 14 | rising-edge coil | none | S B; runs as a plain coil; pull hides the WHOLE BODY | SPELL + pull bug | `R_EDGE xe := c;` |
| 15 | rising edge on a box input pin | X | S B R (edge per scan) | SPELL | `x := AND(R_EDGE IN1 := c, one);` |
| 16 | negated EN pin | refused | S B R | SPELL | `MOVE 5 => y NOT EN c;` |
| 17 | FB instance = array element | refused | S B R; pull UNSUPPORTED "an FB instance the declarations do not name" | SPELL | `fbs[1](CU := go, PV := 10, CV => n);` |
| 18 | METHOD call box | not in design | both drawn forms S B R; Volt push of `x := fbm.Visible(bIn := go);` fails "assignment source is incorrect"; edited rebuild fails "'Visible' is no input of 'Visible'"; drawn form A pulls UNSUPPORTED | SPELL + derive | same text; derive CallType Method + output name |
| 19 | split used before its definition | P10 refuses | S B; reads previous scan (cycle 1 F, 2 T) | SPELL | stored order + LSP warning |
| 20 | split defined below top level | refused | S B R | SPELL | `x := (split1 := a AND b);` |
| 21 | enabled ADD read by data output | refused | only storable read through ENO, which does not build (BOOL vs SINT) | REFUSE | — |
| 22 | comparison with EN + ENO, ENO read | P3 "no ENO" | S B R — premise false | SPELL | `a GT 5 => x EN c` / `lamp := ENO;` |
| 23 | ENO wired to a variable | own spelling | S B; lamp NEVER written at runtime; pull UNSUPPORTED | SPELL + AWKWARD | `MOVE 7 => x ENO => lamp EN c;` + LSP warning |
| 24 | SymbolComment | E | S B R identical; any edit refused | SPELL or demote to L | — |
| 25 | S4 read through CV (slot 1) | E | archive OutputItems `['', null]`: S B R (y = 11); edit refused | SPELL (writer fix) | `y := t(CU := go, PV := 10).CV ADD 10;` |
| 26 | enabled comparison as value (N21) | E | PLCopen-drawn FBD+LD S B R; Volt push refuses | SPELL (writer fix: GT with EN, ENO unset, OutputParam `['']`) | `x := a AND (v GT 40 EN c);` |
| 27 | user FUNCTION call box | L (CallType) | Volt push of `y := AwF(v);` does not compile, nor an edited rebuild; CallType Function + input names compiles and runs | DERIVE (not L) | — |
| 28 | function result name `'   '` | L | runs identically | LOSS OK | — |
| 29 | bit operator stored slot | L | identical | LOSS OK | — |
| 30 | Fixed / Boolean / Address sentinel | L | identical (one FBD network) | LOSS OK | — |
| 31 | BranchCounter, Instance.Type, EN/ENO bools, zero InputFlags | L | — | UNMEASURED | — |
| 32 | SP21 new Ladder editor (`LadderDataModel` JSON) | not in design | every PLCopen LD import lands here; its coil+jump, coil+RETURN, negated coil, enabled compare build and run; Volt pulls `IMPLEMENTATION LADDER UNSUPPORTED` | needs a reader outside NWL | — |
| 33 | nested parallel inline | old design | — | solved by `feed BRANCH (a, b)` | — |
| 34 | MOVE call forms | P5 | S B; run unmeasured | keep | — |
| 35–36 | `AND(a, NOT IN2 := b)`, `MUL(, m, 6)`, backticks | kept | — | keep | — |

Counts: SPELL 20 (one, #27, a derivation), REFUSE 5, LOSS OK 3, UNMEASURED 4 (+ all TwinCAT), 1 body type outside NWL.

Findings that change the design:
1. **Today's push builds non-compiling FUNCTION and METHOD call boxes** (#18, #27): CallType + input formal names are
   required to compile — CallType is D, not L, for project functions and methods too, not only library POUs.
2. **P8's four jump/return refusals all store, build and run** (#9–#12).
3. **P3's "a comparison has no ENO" is false** (#22); a named `ENO => var` pin stores but never writes (#23) — a second
   tree that behaves differently: spell it, warn in the LSP.
4. **Two E rows are writer limits, not vendor limits** (#25, #26): build them the way the PLCopen importer does.
5. **Coil/pin/instance shapes store and run** (#13–#17, #19, #20); the edge-coil network wrongly hides its whole body (#14).
6. **SP21's new Ladder editor — LD2** (#32; export `<!--ObjectVersion: LD2-->`) is a body model Volt does not read at all.
   Owner: not in this change, not implemented yet; its body line ends up `IMPLEMENTATION LD2`.
