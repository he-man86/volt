/**
 * Operator conformance tests.
 *
 * Source: 03-operators.md. Tests how TwinCAT handles arithmetic,
 * comparison, logical, and bitwise operators on various type combinations.
 * Surfaces auto-promotion rules and type-strictness behavior.
 *
 * Most are positive cases (expected to compile). Negative cases test
 * type-mixing TC rejects (e.g. arithmetic between BOOL and INT).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./types.js";

export const OPERATOR_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 03-operators.md — arithmetic, comparison, logical, bitwise
	// ========================================================================

	// ─── Arithmetic ──────────────────────────────────────────────────

	{
		name: "op_arithmetic_same_type",
		pouName: "FB_LANG_op_arithmetic_same_type",
		kind: "function_block",
		feature: "INT + INT → INT, baseline arithmetic",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_oast : FB_LANG_op_arithmetic_same_type;",
		plcPrgBody: "fb_oast.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_arithmetic_same_type
VAR
	iA : INT := 10;
	iB : INT := 20;
	iSum : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iSum := iA + iB;
END_METHOD
`,
	},

	{
		name: "op_arithmetic_int_plus_dint",
		pouName: "FB_LANG_op_arithmetic_int_plus_dint",
		kind: "function_block",
		feature: "INT + DINT — auto-promotion test",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		note: "Result type promotes to the wider operand. Assigning back to DINT should be fine.",
		plcPrgVar: "fb_oapd : FB_LANG_op_arithmetic_int_plus_dint;",
		plcPrgBody: "fb_oapd.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_arithmetic_int_plus_dint
VAR
	iA : INT := 10;
	diB : DINT := 200000;
	diSum : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
diSum := iA + diB;
END_METHOD
`,
	},

	{
		name: "op_arithmetic_int_plus_real",
		pouName: "FB_LANG_op_arithmetic_int_plus_real",
		kind: "function_block",
		feature: "INT + REAL — int auto-coerces to REAL",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_oapr : FB_LANG_op_arithmetic_int_plus_real;",
		plcPrgBody: "fb_oapr.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_arithmetic_int_plus_real
VAR
	iA : INT := 10;
	rB : REAL := 3.14;
	rSum : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rSum := iA + rB;
END_METHOD
`,
	},

	{
		name: "op_modulo_on_real",
		pouName: "FB_LANG_op_modulo_on_real",
		kind: "function_block",
		feature: "REAL MOD REAL — should error per spec (MOD is integer-only)",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		note: "MOD operator is defined for integer types only. Applying to REAL should error.",
		plcPrgVar: "fb_omor : FB_LANG_op_modulo_on_real;",
		plcPrgBody: "fb_omor.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_modulo_on_real
VAR
	rA : REAL := 10.0;
	rB : REAL := 3.0;
	rRem : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
rRem := rA MOD rB;
END_METHOD
`,
	},

	// ─── Comparison ──────────────────────────────────────────────────

	{
		name: "op_comparison_int_vs_int",
		pouName: "FB_LANG_op_comparison_int_vs_int",
		kind: "function_block",
		feature: "INT = INT comparison → BOOL",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ociv : FB_LANG_op_comparison_int_vs_int;",
		plcPrgBody: "fb_ociv.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_comparison_int_vs_int
VAR
	iA : INT := 10;
	iB : INT := 20;
	bEqual : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
bEqual := iA = iB;
END_METHOD
`,
	},

	// ─── Logical ─────────────────────────────────────────────────────

	{
		name: "op_logical_bool",
		pouName: "FB_LANG_op_logical_bool",
		kind: "function_block",
		feature: "AND / OR / NOT on BOOL — standard logical ops",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_olb : FB_LANG_op_logical_bool;",
		plcPrgBody: "fb_olb.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_logical_bool
VAR
	xA : BOOL := TRUE;
	xB : BOOL := FALSE;
	xRes : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
xRes := xA AND NOT xB;
END_METHOD
`,
	},

	{
		name: "op_bitwise_on_int",
		pouName: "FB_LANG_op_bitwise_on_int",
		kind: "function_block",
		feature: "AND / OR / XOR on integer types are BITWISE (same keywords as logical)",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_oboi : FB_LANG_op_bitwise_on_int;",
		plcPrgBody: "fb_oboi.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_bitwise_on_int
VAR
	wA : WORD := 16#00FF;
	wB : WORD := 16#FF00;
	wRes : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
wRes := wA OR wB;
END_METHOD
`,
	},

	{
		name: "op_shift_left",
		pouName: "FB_LANG_op_shift_left",
		kind: "function_block",
		feature: "SHL (shift left) on integer type",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_osl : FB_LANG_op_shift_left;",
		plcPrgBody: "fb_osl.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_shift_left
VAR
	wIn : WORD := 16#0001;
	wOut : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
wOut := SHL(wIn, 4);
END_METHOD
`,
	},

	// ─── Negative: type-mixing TC rejects ────────────────────────────

	{
		name: "op_arithmetic_bool_plus_int",
		pouName: "FB_LANG_op_arithmetic_bool_plus_int",
		kind: "function_block",
		feature: "BOOL + INT — should error (no auto-coercion across BOOL/numeric boundary)",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		note: "BOOL is distinct from numeric types in IEC 61131-3. Arithmetic across the boundary should error.",
		plcPrgVar: "fb_oabp : FB_LANG_op_arithmetic_bool_plus_int;",
		plcPrgBody: "fb_oabp.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_arithmetic_bool_plus_int
VAR
	xA : BOOL := TRUE;
	iB : INT := 10;
	iRes : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iRes := xA + iB;
END_METHOD
`,
	},

	// ─── Selection operators (IEC 61131-3 standard) ─────────────────

	{
		name: "op_sel_bool_picker",
		pouName: "FB_LANG_op_sel",
		kind: "function_block",
		feature: "SEL(<bool>, <ifFalse>, <ifTrue>) — ternary-like picker",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_sel : FB_LANG_op_sel;",
		plcPrgBody: "fb_sel.Pick();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sel
VAR
	bUseHigh : BOOL := TRUE;
	iResult : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
iResult := SEL(bUseHigh, 10, 99);
END_METHOD
`,
	},

	{
		name: "op_mux_multi_select",
		pouName: "FB_LANG_op_mux",
		kind: "function_block",
		feature: "MUX(<index>, <opt0>, <opt1>, <opt2>) — N-way selector",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_mux : FB_LANG_op_mux;",
		plcPrgBody: "fb_mux.Pick();",
		source:
`FUNCTION_BLOCK FB_LANG_op_mux
VAR
	iIndex : INT := 1;
	iResult : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
iResult := MUX(iIndex, 100, 200, 300);
END_METHOD
`,
	},

	{
		name: "op_min_max",
		pouName: "FB_LANG_op_min_max",
		kind: "function_block",
		feature: "MIN(a, b) / MAX(a, b) — variadic min/max",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_mm : FB_LANG_op_min_max;",
		plcPrgBody: "fb_mm.Pick();",
		source:
`FUNCTION_BLOCK FB_LANG_op_min_max
VAR
	iA : INT := 5;
	iB : INT := 10;
	iLow : INT;
	iHigh : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Pick
iLow := MIN(iA, iB);
iHigh := MAX(iA, iB);
END_METHOD
`,
	},

	{
		name: "op_limit_clamp",
		pouName: "FB_LANG_op_limit",
		kind: "function_block",
		feature: "LIMIT(<min>, <value>, <max>) — clamp value into range",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lim : FB_LANG_op_limit;",
		plcPrgBody: "fb_lim.Clamp();",
		source:
`FUNCTION_BLOCK FB_LANG_op_limit
VAR
	iRaw : INT := 150;
	iClamped : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Clamp
iClamped := LIMIT(0, iRaw, 100);
END_METHOD
`,
	},

	// ─── Math functions (IEC 61131-3 standard) ──────────────────────

	{
		name: "op_math_abs",
		pouName: "FB_LANG_op_math_abs",
		kind: "function_block",
		feature: "ABS(<numeric>) — absolute value",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_abs : FB_LANG_op_math_abs;",
		plcPrgBody: "fb_abs.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_abs
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
		expectTcAccepts: true,
		plcPrgVar: "fb_sq : FB_LANG_op_math_sqrt;",
		plcPrgBody: "fb_sq.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_sqrt
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
		expectTcAccepts: true,
		plcPrgVar: "fb_ln : FB_LANG_op_math_ln;",
		plcPrgBody: "fb_ln.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_ln
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
		expectTcAccepts: true,
		plcPrgVar: "fb_lg : FB_LANG_op_math_log;",
		plcPrgBody: "fb_lg.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_log
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
		expectTcAccepts: true,
		plcPrgVar: "fb_ex : FB_LANG_op_math_exp;",
		plcPrgBody: "fb_ex.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_exp
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
		expectTcAccepts: true,
		plcPrgVar: "fb_itrig : FB_LANG_op_math_inverse_trig;",
		plcPrgBody: "fb_itrig.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_inverse_trig
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
		expectTcAccepts: true,
		plcPrgVar: "fb_trig : FB_LANG_op_math_trig;",
		plcPrgBody: "fb_trig.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_trig
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
		expectTcAccepts: true,
		plcPrgVar: "fb_expt : FB_LANG_op_math_expt;",
		plcPrgBody: "fb_expt.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_math_expt
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
		expectTcAccepts: true,
		plcPrgVar: "fb_shr : FB_LANG_op_shift_right;",
		plcPrgBody: "fb_shr.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_shift_right
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
		expectTcAccepts: true,
		plcPrgVar: "fb_rol : FB_LANG_op_rotate_left;",
		plcPrgBody: "fb_rol.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_rotate_left
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
		expectTcAccepts: true,
		plcPrgVar: "fb_ror : FB_LANG_op_rotate_right;",
		plcPrgBody: "fb_ror.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_op_rotate_right
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

	// ─── CODESYS __-prefixed system operators ───────────────────────
	// Each test records TC's actual behavior — these are CODESYS
	// extensions, so TC support is platform-dependent. Some are
	// runtime-system features that TC implements differently or not at
	// all. Catalog encodes recorded reality.

	{
		name: "op_sys_isvalidref",
		pouName: "FB_LANG_op_sys_isvalidref",
		kind: "function_block",
		feature: "__ISVALIDREF — check that a REFERENCE TO is bound to a valid target",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ivr : FB_LANG_op_sys_isvalidref;",
		plcPrgBody: "fb_ivr.Check();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sys_isvalidref
VAR
	iTarget : INT := 42;
	refTo : REFERENCE TO INT;
	bValid : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Check
refTo REF= iTarget;
bValid := __ISVALIDREF(refTo);
END_METHOD
`,
	},

	{
		name: "op_sys_varinfo",
		pouName: "FB_LANG_op_sys_varinfo",
		kind: "function_block",
		feature: "__VARINFO — CODESYS-only; TC rejects (platform-dependent)",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects __VARINFO — CODESYS-only system operator. Use TwinCAT's specific introspection facilities instead.",
		plcPrgVar: "fb_vi : FB_LANG_op_sys_varinfo;",
		plcPrgBody: "fb_vi.Inspect();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sys_varinfo
VAR
	iValue : INT := 99;
	wSize : UDINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
wSize := __VARINFO(iValue).size;
END_METHOD
`,
	},

	{
		name: "op_sys_currenttask",
		pouName: "FB_LANG_op_sys_currenttask",
		kind: "function_block",
		feature: "__CURRENTTASK — CODESYS-only; TC rejects (platform-dependent)",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects __CURRENTTASK. TwinCAT exposes task context via TwinCAT.Standard's GetCurTaskIndex() helpers instead.",
		plcPrgVar: "fb_ct : FB_LANG_op_sys_currenttask;",
		plcPrgBody: "fb_ct.Inspect();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sys_currenttask
VAR
	pTask : POINTER TO BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
pTask := __CURRENTTASK;
END_METHOD
`,
	},

	{
		name: "op_sys_try_catch",
		pouName: "FB_LANG_op_sys_try_catch",
		kind: "function_block",
		feature: "__TRY / __CATCH / __FINALLY / __ENDTRY — CODESYS-only; TC rejects",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects structured-exception-handling pragmas. CODESYS-only feature; TC uses simpler error-flag patterns or PLC_Exception traps.",
		plcPrgVar: "fb_tc : FB_LANG_op_sys_try_catch;",
		plcPrgBody: "fb_tc.Guarded();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sys_try_catch
VAR
	iValue : INT;
	bCleanup : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Guarded
__TRY
	iValue := 1;
__CATCH(exc)
	iValue := -1;
__FINALLY
	bCleanup := TRUE;
__ENDTRY
END_METHOD
`,
	},

	{
		name: "op_sys_new_delete",
		pouName: "FB_LANG_op_sys_new_delete",
		kind: "function_block",
		feature: "__NEW / __DELETE — dynamic allocation under `{attribute 'enable_dynamic_creation'}`",
		fromDoc: "03-operators.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "TC accepts __NEW / __DELETE when the FB carries `{attribute 'enable_dynamic_creation'}`. Without that attribute TC rejects the operators; the attribute is the documented opt-in (CODESYS supports the operators unconditionally, TC requires the explicit opt-in).",
		plcPrgVar: "fb_nd : FB_LANG_op_sys_new_delete;",
		plcPrgBody: "fb_nd.Alloc();",
		source:
`{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_op_sys_new_delete
VAR
	pInst : POINTER TO FB_LANG_op_sys_new_delete;
END_VAR

END_FUNCTION_BLOCK

METHOD Alloc
pInst := __NEW(FB_LANG_op_sys_new_delete);
IF pInst <> 0 THEN
	__DELETE(pInst);
END_IF
END_METHOD
`,
	},

	{
		name: "op_sys_queryinterface",
		pouName: "FB_LANG_op_sys_queryinterface",
		kind: "function_block",
		feature: "__QUERYINTERFACE — CODESYS-only runtime interface query; TC rejects",
		fromDoc: "03-operators.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects __QUERYINTERFACE. CODESYS-only; TC has its own runtime-interface query primitives in TwinCAT.SystemBase.",
		plcPrgVar: "fb_qi : FB_LANG_op_sys_queryinterface;",
		plcPrgBody: "fb_qi.Query();",
		source:
`FUNCTION_BLOCK FB_LANG_op_sys_queryinterface
VAR
	bFound : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Query
bFound := __QUERYINTERFACE(THIS^, ITF_LANG_with_method);
END_METHOD
`,
	},
];
