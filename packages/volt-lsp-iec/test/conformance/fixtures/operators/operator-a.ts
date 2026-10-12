/**
 * the fixtures of `operator.ts` — part A: Arithmetic; Comparison; Logical; Negative: type-mixing TC rejects; Selection operators (IEC 61131-3 standard).
 *
 * One slice of `operator.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const OPERATOR_TESTS_A: readonly LanguageTest[] = [
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
    plcPrgVar: "fb_oast : FB_LANG_op_arithmetic_same_type;",
    plcPrgBody: "fb_oast.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_arithmetic_same_type
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
    note: "Result type promotes to the wider operand. Assigning back to DINT should be fine.",
    plcPrgVar: "fb_oapd : FB_LANG_op_arithmetic_int_plus_dint;",
    plcPrgBody: "fb_oapd.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_arithmetic_int_plus_dint
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
    plcPrgVar: "fb_oapr : FB_LANG_op_arithmetic_int_plus_real;",
    plcPrgBody: "fb_oapr.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_arithmetic_int_plus_real
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
    note: "MOD operator is defined for integer types only. Applying to REAL should error.",
    plcPrgVar: "fb_omor : FB_LANG_op_modulo_on_real;",
    plcPrgBody: "fb_omor.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_modulo_on_real
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
    plcPrgVar: "fb_ociv : FB_LANG_op_comparison_int_vs_int;",
    plcPrgBody: "fb_ociv.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_comparison_int_vs_int
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
    plcPrgVar: "fb_olb : FB_LANG_op_logical_bool;",
    plcPrgBody: "fb_olb.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_logical_bool
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
    plcPrgVar: "fb_oboi : FB_LANG_op_bitwise_on_int;",
    plcPrgBody: "fb_oboi.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_bitwise_on_int
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
    plcPrgVar: "fb_osl : FB_LANG_op_shift_left;",
    plcPrgBody: "fb_osl.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_shift_left
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
    note: "BOOL is distinct from numeric types in IEC 61131-3. Arithmetic across the boundary should error.",
    plcPrgVar: "fb_oabp : FB_LANG_op_arithmetic_bool_plus_int;",
    plcPrgBody: "fb_oabp.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_op_arithmetic_bool_plus_int
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
    plcPrgVar: "fb_sel : FB_LANG_op_sel;",
    plcPrgBody: "fb_sel.Pick();",
    source: `FUNCTION_BLOCK FB_LANG_op_sel
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
    plcPrgVar: "fb_mux : FB_LANG_op_mux;",
    plcPrgBody: "fb_mux.Pick();",
    source: `FUNCTION_BLOCK FB_LANG_op_mux
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
    plcPrgVar: "fb_mm : FB_LANG_op_min_max;",
    plcPrgBody: "fb_mm.Pick();",
    source: `FUNCTION_BLOCK FB_LANG_op_min_max
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
    plcPrgVar: "fb_lim : FB_LANG_op_limit;",
    plcPrgBody: "fb_lim.Clamp();",
    source: `FUNCTION_BLOCK FB_LANG_op_limit
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
]
