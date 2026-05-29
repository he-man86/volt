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
import type { LanguageTest } from "./pragma-tests.js";

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
];
