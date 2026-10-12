/**
 * the fixtures of `operator.ts` — part B: Math functions (IEC 61131-3 standard); Bit shifts beyond SHL.
 *
 * One slice of `operator.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { X87_TRIG_DIVERGENCES } from "../../support/divergences-transpile.js"

export const OPERATOR_TESTS_B: readonly LanguageTest[] = [
  // ─── Math functions (IEC 61131-3 standard) ──────────────────────

  {
    name: "op_math_abs",
    pouName: "FB_LANG_op_math_abs",
    kind: "function_block",
    feature: "ABS(<numeric>) — absolute value",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_abs : FB_LANG_op_math_abs;",
    plcPrgBody: "fb_abs.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_abs
VAR
	iSigned : INT := -42;
	iMag : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iMag := ABS(iSigned);
END_METHOD
`,
  },
  {
    name: "op_math_sqrt_real",
    pouName: "FB_LANG_op_math_sqrt",
    kind: "function_block",
    feature: "SQRT(<real>) — square root",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_sq : FB_LANG_op_math_sqrt;",
    plcPrgBody: "fb_sq.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_sqrt
VAR
	rInput : LREAL := 16.0;
	rRoot : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rRoot := SQRT(rInput);
END_METHOD
`,
  },
  {
    name: "op_math_ln",
    pouName: "FB_LANG_op_math_ln",
    kind: "function_block",
    feature: "LN(<real>) — natural logarithm",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_ln : FB_LANG_op_math_ln;",
    plcPrgBody: "fb_ln.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_ln
VAR
	rInput : LREAL := 2.71828;
	rResult : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rResult := LN(rInput);
END_METHOD
`,
  },
  {
    name: "op_math_log",
    pouName: "FB_LANG_op_math_log",
    kind: "function_block",
    feature: "LOG(<real>) — base-10 logarithm",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_lg : FB_LANG_op_math_log;",
    plcPrgBody: "fb_lg.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_log
VAR
	rInput : LREAL := 1000.0;
	rResult : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rResult := LOG(rInput);
END_METHOD
`,
  },
  {
    name: "op_math_exp",
    pouName: "FB_LANG_op_math_exp",
    kind: "function_block",
    feature: "EXP(<real>) — e^x exponential",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_ex : FB_LANG_op_math_exp;",
    plcPrgBody: "fb_ex.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_exp
VAR
	rInput : LREAL := 1.0;
	rResult : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rResult := EXP(rInput);
END_METHOD
`,
  },
  {
    name: "op_math_inverse_trig",
    pouName: "FB_LANG_op_math_inverse_trig",
    kind: "function_block",
    feature: "ASIN / ACOS / ATAN — inverse trig functions on REAL",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_itrig : FB_LANG_op_math_inverse_trig;",
    plcPrgBody: "fb_itrig.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_inverse_trig
VAR
	rInput : LREAL := 0.5;
	rAsin : LREAL;
	rAcos : LREAL;
	rAtan : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rAsin := ASIN(rInput);
rAcos := ACOS(rInput);
rAtan := ATAN(rInput);
END_METHOD
`,
  },
  {
    name: "op_math_trig",
    pouName: "FB_LANG_op_math_trig",
    kind: "function_block",
    feature: "SIN / COS / TAN — trigonometric functions on REAL",
    fromDoc: "03-operators.md",
    // Measured 2026-09-14, once method calls lowered: COS(1.5708) is -3.6732051033465756E-06 in CODESYS and
    // -3.673205103346574e-6 from the IEEE libm the interpreter and Rust use — about four ULPs apart (one ULP there is
    // 2^-71), near a zero of COS. SIN and TAN agreed, as do `trig_precision`'s angles — but deferring the case takes its SIN
    // and TAN out of the gate too.
    //
    // NAMED 2026-09-19: the exact value to 300 bits is -3.6732051033465738e-6, so THIS side is correctly rounded
    // and CODESYS is the one a few ULPs out — its trig is the x87 FPU's. 1.5708 is below pi and reduces to
    // itself, so what shows here is the hardware KERNEL, not the 66-bit argument reduction that explains
    // `mathdom_sin_large`. See `transpile/semantics/math.ts`.
    deferred: { transpile: X87_TRIG_DIVERGENCES.op_math_trig },
    plcPrgVar: "fb_trig : FB_LANG_op_math_trig;",
    plcPrgBody: "fb_trig.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_trig
VAR
	rAngle : LREAL := 1.5708;
	rSin : LREAL;
	rCos : LREAL;
	rTan : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rSin := SIN(rAngle);
rCos := COS(rAngle);
rTan := TAN(rAngle);
END_METHOD
`,
  },
  {
    name: "op_math_expt",
    pouName: "FB_LANG_op_math_expt",
    kind: "function_block",
    feature: "EXPT(base, exp) — exponentiation",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_expt : FB_LANG_op_math_expt;",
    plcPrgBody: "fb_expt.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_math_expt
VAR
	rBase : LREAL := 2.0;
	rResult : LREAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rResult := EXPT(rBase, 8);
END_METHOD
`,
  },
  // ─── Bit shifts beyond SHL ──────────────────────────────────────

  {
    name: "op_shift_right",
    pouName: "FB_LANG_op_shift_right",
    kind: "function_block",
    feature: "SHR — logical right shift",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_shr : FB_LANG_op_shift_right;",
    plcPrgBody: "fb_shr.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_shift_right
VAR
	wValue : WORD := 16#FF00;
	wShifted : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
wShifted := SHR(wValue, 4);
END_METHOD
`,
  },
  {
    name: "op_rotate_left",
    pouName: "FB_LANG_op_rotate_left",
    kind: "function_block",
    feature: "ROL — bitwise rotate left",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_rol : FB_LANG_op_rotate_left;",
    plcPrgBody: "fb_rol.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_rotate_left
VAR
	bValue : BYTE := 16#81;
	bRotated : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
bRotated := ROL(bValue, 1);
END_METHOD
`,
  },
  {
    name: "op_rotate_right",
    pouName: "FB_LANG_op_rotate_right",
    kind: "function_block",
    feature: "ROR — bitwise rotate right",
    fromDoc: "03-operators.md",
    plcPrgVar: "fb_ror : FB_LANG_op_rotate_right;",
    plcPrgBody: "fb_ror.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_rotate_right
VAR
	bValue : BYTE := 16#03;
	bRotated : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
bRotated := ROR(bValue, 1);
END_METHOD
`,
  },
]
