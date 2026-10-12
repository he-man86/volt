/**
 * Execution cases — each is ONE program, run for `cycles` scan cycles both in CODESYS's simulator (`bun run record:exec`)
 * and through the transpiler (transpile-replay.test.ts), and every variable must agree. They are conformance fixtures: the
 * program IS PLC_PRG (`plcPrgVar`/`plcPrgBody`, no units of its own), which is exactly what both recorders build — so
 * the LSP replay checks the same source once it has a build recording (unify-conformance-suite).
 *
 * A case states a question about the vendor, not the answer: nothing here says what the result should be. The
 * recording does. Add a case, re-record, and the replay tells you whether the transpiler already agrees.
 */
import type { LanguageTest } from "../../types.js"
import { ExecCase } from "./execution-shared.js"
import { CASES_A } from "./execution-a.js"
import { CASES_B } from "./execution-b.js"
import { CASES_C } from "./execution-c.js"
import { CASES_D } from "./execution-d.js"
import { CASES_E } from "./execution-e.js"
import { CASES_F } from "./execution-f.js"

const CASES: readonly ExecCase[] = [...CASES_A, ...CASES_B, ...CASES_C, ...CASES_D, ...CASES_E, ...CASES_F]

/** An execution case as a conformance fixture: no units, its program is PLC_PRG; `rejects` is `refused`, and a
 *  `deferred` reason belongs to the transpiler. The name keeps a `PRG_LANG_` pouName unique in the replay's project. */
function program(c: ExecCase): LanguageTest {
  return {
    name: c.name,
    pouName: `PRG_LANG_${c.name}`,
    kind: "program",
    feature: `execution: ${c.name}`,
    fromDoc: "execution-oracle",
    source: "",
    plcPrgVar: c.vars,
    plcPrgBody: c.body,
    ...(c.cycles === undefined ? {} : { cycles: c.cycles }),
    ...(c.rejects === undefined ? {} : { refused: c.rejects }),
    ...(c.deferred === undefined && c.lspDeferred === undefined
      ? {}
      : { deferred: { ...(c.deferred === undefined ? {} : { transpile: c.deferred }), ...(c.lspDeferred === undefined ? {} : { lsp: c.lspDeferred }) } }),
    ...(c.execSkip === undefined ? {} : { execSkip: c.execSkip }),
  }
}

/** A case that needs POUs of its own (a FUNCTION with a side effect) — an FB holding the question, its helpers beside
 *  it in the same source, run from PLC_PRG as `inst`. */
function withUnits(name: string, feature: string, source: string, deferred?: string): LanguageTest {
  return {
    ...(deferred === undefined ? {} : { deferred: { transpile: deferred } }),
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature: `execution: ${feature}`,
    fromDoc: "execution-oracle",
    source,
    plcPrgVar: `inst : FB_LANG_${name};`,
    plcPrgBody: "inst();",
  }
}

/** A FUNCTION that bumps its VAR_IN_OUT and answers the new value — a call whose running is visible afterwards. */
function inc(fn: string): string {
  return `FUNCTION ${fn} : INT\nVAR_IN_OUT\n\tc : INT;\nEND_VAR\nc := c + 1;\n${fn} := c;\nEND_FUNCTION\n`
}

// transpile-review-2026-09-29 task 41: do SEL / MUX evaluate the inputs they do NOT select (the unselected counter
// moves or not), and in what order does LIMIT evaluate its arguments when each modifies the same variable (Add1 then
// Dbl leaves x=4, Dbl then Add1 leaves x=3)? One fixture per builtin. CODESYS: only the selected input; MN before IN.
const SIDE_EFFECT_TESTS: readonly LanguageTest[] = [
  withUnits(
    "tr_41_mux_side_effects",
    "MUX runs the inputs it does not select?",
    `${inc("FUN_LANG_tr41_mux_Inc")}
FUNCTION_BLOCK FB_LANG_tr_41_mux_side_effects
VAR
	a : INT;
	b : INT;
	res : INT;
END_VAR
res := MUX(0, FUN_LANG_tr41_mux_Inc(a), FUN_LANG_tr41_mux_Inc(b));
END_FUNCTION_BLOCK
`,
  ),
  withUnits(
    "tr_41_sel_side_effects",
    "SEL runs the input it does not select?",
    `${inc("FUN_LANG_tr41_sel_Inc")}
FUNCTION_BLOCK FB_LANG_tr_41_sel_side_effects
VAR
	a2 : INT;
	b2 : INT;
	r2 : INT;
END_VAR
r2 := SEL(FALSE, FUN_LANG_tr41_sel_Inc(a2), FUN_LANG_tr41_sel_Inc(b2));
END_FUNCTION_BLOCK
`,
  ),
  withUnits(
    "tr_41_limit_evaluation_order",
    "LIMIT's argument evaluation order",
    `FUNCTION FUN_LANG_tr41_Add1 : INT
VAR_IN_OUT
	x : INT;
END_VAR
x := x + 1;
FUN_LANG_tr41_Add1 := x;
END_FUNCTION

FUNCTION FUN_LANG_tr41_Dbl : INT
VAR_IN_OUT
	x : INT;
END_VAR
x := x * 2;
FUN_LANG_tr41_Dbl := x;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr_41_limit_evaluation_order
VAR
	x : INT := 1;
	r3 : INT;
END_VAR
r3 := LIMIT(FUN_LANG_tr41_Add1(x), FUN_LANG_tr41_Dbl(x), 1000);
END_FUNCTION_BLOCK
`,
  ),
  // transpile-restructure 6.A.30 (Appendix B: "rotate-in-promoted-width, filed as an ANY-argument ordering bug with no
  // recording"): ROL / ROR / SHL / SHR with BOTH arguments calls that change the same variable — Next (x + 1, as a BYTE)
  // then Twice (x * 2) leaves x = 4 and rotates 2 by 4; the other order leaves x = 3 and rotates 3 by 2. `r5` rotates an
  // EXPRESSION (a BYTE sum, promoted) into a WORD, the shape `rotate_of_expression` measured, with calls in it.
  withUnits(
    "tr_a30_rotate_argument_order",
    "ROL / ROR / SHL / SHR: which argument runs first, when both change one variable?",
    `FUNCTION FUN_LANG_tr_a30_Next : BYTE
VAR_IN_OUT
	c : INT;
END_VAR
c := c + 1;
FUN_LANG_tr_a30_Next := INT_TO_BYTE(c);
END_FUNCTION

FUNCTION FUN_LANG_tr_a30_Twice : INT
VAR_IN_OUT
	c : INT;
END_VAR
c := c * 2;
FUN_LANG_tr_a30_Twice := c;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr_a30_rotate_argument_order
VAR
	x1 : INT := 1;
	x2 : INT := 1;
	x3 : INT := 1;
	x4 : INT := 1;
	x5 : INT := 1;
	r1 : BYTE;
	r2 : BYTE;
	r3 : WORD;
	r4 : BYTE;
	r5 : WORD;
END_VAR
r1 := ROL(FUN_LANG_tr_a30_Next(x1), FUN_LANG_tr_a30_Twice(x1));
r2 := ROR(FUN_LANG_tr_a30_Next(x2), FUN_LANG_tr_a30_Twice(x2));
r3 := SHL(FUN_LANG_tr_a30_Next(x3), FUN_LANG_tr_a30_Twice(x3));
r4 := SHR(FUN_LANG_tr_a30_Next(x4), FUN_LANG_tr_a30_Twice(x4));
r5 := ROL(FUN_LANG_tr_a30_Next(x5) + BYTE#16#80, FUN_LANG_tr_a30_Twice(x5));
END_FUNCTION_BLOCK
`,
  ),
  // transpile-restructure 6.B.4 (1.7.18's difference): how does a POSITIONAL argument count a VAR_OUTPUT declared among
  // the parameters? Lowering refuses the call (`call-positional`), the front-end skips the output and binds the next
  // input; neither rule was recorded. `F(3, 4)` reads 304 when the output is skipped (4 binds `b`); `F(3, x, 5)` reads
  // 305 and leaves x = 7 when the output is counted (x receives `o`, 5 binds `b`). Whichever builds is the rule.
  withUnits(
    "tr_b4_positional_past_output",
    "a positional argument past a VAR_OUTPUT declared between two VAR_INPUTs",
    `FUNCTION F_LANG_tr_b4_past : INT
VAR_INPUT
	a : INT;
END_VAR
VAR_OUTPUT
	o : INT;
END_VAR
VAR_INPUT
	b : INT;
END_VAR
o := 7;
F_LANG_tr_b4_past := a * 100 + b;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr_b4_positional_past_output
VAR
	res : INT;
END_VAR
res := F_LANG_tr_b4_past(3, 4);
END_FUNCTION_BLOCK
`,
  ),
  withUnits(
    "tr_b4_positional_into_output",
    "positional arguments counting a VAR_OUTPUT declared between two VAR_INPUTs",
    `FUNCTION F_LANG_tr_b4_into : INT
VAR_INPUT
	a : INT;
END_VAR
VAR_OUTPUT
	o : INT;
END_VAR
VAR_INPUT
	b : INT;
END_VAR
o := 7;
F_LANG_tr_b4_into := a * 100 + b;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr_b4_positional_into_output
VAR
	res : INT;
	x : INT;
END_VAR
res := F_LANG_tr_b4_into(3, x, 5);
END_FUNCTION_BLOCK
`,
  ),
  // transpile-restructure 6.B.5 (1.1.10's gate: an initializer and a body must answer a platform conversion alike): the
  // TY11 conversions (`__XINT_TO_DINT`, `DINT_TO___XINT`, `DINT_TO___UXINT`) in VAR initializers, one inside an
  // expression. On the 64-bit oracle target `__XINT` is LINT and `__UXINT` ULINT, so DINT_TO___UXINT(-1) is 2^64 - 1.
  withUnits(
    "tr_b5_platform_conversion_initializers",
    "platform-integer conversions (TY11) in VAR initializers",
    `FUNCTION_BLOCK FB_LANG_tr_b5_platform_conversion_initializers
VAR
	a : LINT := DINT_TO___XINT(5);
	b : DINT := __XINT_TO_DINT(7);
	c : DINT := 5 + __XINT_TO_DINT(5);
	d : ULINT := DINT_TO___UXINT(-1);
	e : __UXINT := INT_TO___UXINT(3);
	ra : LINT;
	rb : DINT;
	rc : DINT;
	rd : ULINT;
	re : __UXINT;
END_VAR
ra := a;
rb := b;
rc := c;
rd := d;
re := e;
END_FUNCTION_BLOCK
`,
  ),
  // 6Bb gate review (6.B.1): REAL_TO_BIT into a BIT struct field (where a BIT lives), read back through a BOOL
  withUnits(
    "tr_b1_real_to_bit_field",
    "REAL_TO_BIT into BIT struct fields",
    `TYPE DUT_LANG_tr_b1_bits :
STRUCT
	b1 : BIT;
	b2 : BIT;
	b3 : BIT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_tr_b1_real_to_bit_field
VAR
	bits : DUT_LANG_tr_b1_bits;
	x : REAL := 0.4;
	z : REAL := 0.0;
	m : REAL := -1.5;
	r1 : BOOL;
	r2 : BOOL;
	r3 : BOOL;
END_VAR
bits.b1 := REAL_TO_BIT(x);
bits.b2 := REAL_TO_BIT(z);
bits.b3 := REAL_TO_BIT(m);
r1 := bits.b1;
r2 := bits.b2;
r3 := bits.b3;
END_FUNCTION_BLOCK
`,
  ),
  // 6Af gate review: the run-time twin of `tr_a31_sizeof_bound_fb_var_input_constant` — SIZEOF of an FB whose VAR_INPUT
  // CONSTANT is a per-call parameter (24 if it takes room, 16 if not)
  withUnits(
    "tr_a31_sizeof_fb_var_input_constant",
    "SIZEOF of an FB instance with a VAR_INPUT CONSTANT",
    `FUNCTION_BLOCK FB_LANG_tr_a31_vic_run
VAR_INPUT CONSTANT
	i : LINT;
END_VAR
VAR
	d : DINT;
END_VAR
d := d + LINT_TO_DINT(i);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_tr_a31_sizeof_fb_var_input_constant
VAR
	g : FB_LANG_tr_a31_vic_run;
	s1 : ULINT;
END_VAR
s1 := SIZEOF(g);
END_FUNCTION_BLOCK
`,
  ),
]

export const EXECUTION_TESTS: readonly LanguageTest[] = [...CASES.map(program), ...SIDE_EFFECT_TESTS]
