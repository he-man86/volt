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
import type { LanguageTest } from "../types.js"

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
    // and TAN out of the gate too. Matching the controller's own trig routine bit for bit is not modelled.
    deferred: { transpile: "COS near π/2 differs from CODESYS in the last ULP — its trig routine is not modelled" },
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
    plcPrgVar: "fb_ivr : FB_LANG_op_sys_isvalidref;",
    plcPrgBody: "fb_ivr.Check();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_isvalidref
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __VARINFO — CODESYS-only system operator. Use TwinCAT's specific introspection facilities instead.",
    plcPrgVar: "fb_vi : FB_LANG_op_sys_varinfo;",
    plcPrgBody: "fb_vi.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_varinfo
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __CURRENTTASK. TwinCAT exposes task context via TwinCAT.Standard's GetCurTaskIndex() helpers instead.",
    plcPrgVar: "fb_ct : FB_LANG_op_sys_currenttask;",
    plcPrgBody: "fb_ct.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_currenttask
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects structured-exception-handling pragmas. CODESYS-only feature; TC uses simpler error-flag patterns or PLC_Exception traps.",
    plcPrgVar: "fb_tc : FB_LANG_op_sys_try_catch;",
    plcPrgBody: "fb_tc.Guarded();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_try_catch
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
    note: "TC accepts __NEW / __DELETE when the FB carries `{attribute 'enable_dynamic_creation'}`. Without that attribute TC rejects the operators; the attribute is the documented opt-in (CODESYS supports the operators unconditionally, TC requires the explicit opt-in).",
    plcPrgVar: "fb_nd : FB_LANG_op_sys_new_delete;",
    plcPrgBody: "fb_nd.Alloc();",
    source: `{attribute 'enable_dynamic_creation'}
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects __QUERYINTERFACE. CODESYS-only; TC has its own runtime-interface query primitives in TwinCAT.SystemBase.",
    plcPrgVar: "fb_qi : FB_LANG_op_sys_queryinterface;",
    plcPrgBody: "fb_qi.Query();",
    source: `FUNCTION_BLOCK FB_LANG_op_sys_queryinterface
VAR
	bFound : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Query
bFound := __QUERYINTERFACE(THIS^, ITF_LANG_with_method);
END_METHOD
`,
  },
  // ─── HOW DOES THE VENDOR ORDER TWO STRINGS? ────────────────────────────────────────────────────────
  // MAX/MIN/LIMIT over a STRING lowered, and the interpreter compared the text (`MAX('abc','abd')` = 'abd') while the
  // emitted Rust printed `.max()` on an `IecStr`, which has PartialOrd but not Ord — so that program did not COMPILE
  // (E0599). Both halves were wrong to ship: nothing records what CODESYS orders two strings by, or whether it accepts
  // the call at all. Refused as `value-string-order` until these answer it. `>` and `<` on strings are recorded too,
  // since an order for those and an order for MAX need not be the same thing.
  {
    name: "string_max",
    pouName: "FB_LANG_string_max",
    kind: "function_block" as const,
    feature: "MAX over two STRINGs — does it compile, and which one wins?",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_max : FB_LANG_string_max;",
    plcPrgBody: "inst_string_max();",
    source: "FUNCTION_BLOCK FB_LANG_string_max\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tout : STRING;\nEND_VAR\nout := MAX(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_min",
    pouName: "FB_LANG_string_min",
    kind: "function_block" as const,
    feature: "MIN over two STRINGs",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_min : FB_LANG_string_min;",
    plcPrgBody: "inst_string_min();",
    source: "FUNCTION_BLOCK FB_LANG_string_min\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tout : STRING;\nEND_VAR\nout := MIN(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_limit",
    pouName: "FB_LANG_string_limit",
    kind: "function_block" as const,
    feature: "LIMIT over three STRINGs",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_limit : FB_LANG_string_limit;",
    plcPrgBody: "inst_string_limit();",
    source: "FUNCTION_BLOCK FB_LANG_string_limit\nVAR\n\tmn : STRING := 'a';\n\tin_ : STRING := 'b';\n\tmx : STRING := 'c';\n\tout : STRING;\nEND_VAR\nout := LIMIT(mn, in_, mx);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_compare_operators",
    deferred: { lsp: "2026-09-18: no LSP error for a variable named `lt` — LT is a reserved operator name" },
    refused: "Unexpected token 'lt' found",
    pouName: "FB_LANG_string_compare_operators",
    kind: "function_block" as const,
    feature: "the comparison OPERATORS on STRINGs — a different question from MAX",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_compare_operators : FB_LANG_string_compare_operators;",
    plcPrgBody: "inst_string_compare_operators();",
    source: "FUNCTION_BLOCK FB_LANG_string_compare_operators\nVAR\n\ta : STRING := 'abc';\n\tb : STRING := 'abd';\n\tlt : BOOL;\n\tgt : BOOL;\n\teq : BOOL;\n\tshorter : STRING := 'ab';\n\tshortLt : BOOL;\nEND_VAR\nlt := a < b;\ngt := a > b;\neq := a = b;\nshortLt := shorter < a;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "string_max_differing_case",
    pouName: "FB_LANG_string_max_differing_case",
    kind: "function_block" as const,
    feature: "MAX over STRINGs differing only in CASE — is the order case-sensitive?",
    fromDoc: "string-order",
    plcPrgVar: "inst_string_max_differing_case : FB_LANG_string_max_differing_case;",
    plcPrgBody: "inst_string_max_differing_case();",
    source: "FUNCTION_BLOCK FB_LANG_string_max_differing_case\nVAR\n\tupper : STRING := 'ABC';\n\tlower : STRING := 'abc';\n\tout : STRING;\nEND_VAR\nout := MAX(upper, lower);\nEND_FUNCTION_BLOCK\n",
  },
  // ─── THE FUNCTION-CALL SPELLING OF AN OPERATOR ─────────────────────────────────────────────────────
  // `03-operators.md` gives ADD, SUB, MUL, DIV, GT, LT, LE, GE, EQ and NE their own pages: CODESYS accepts `ADD(a, b)`
  // as well as `a + b`. Lowering takes the SYMBOL form only, so every call form is refused as a generic `expr-call`
  // (measured 2026-09-18, all ten). Implementing it is coverage work and out of this change's scope — these record
  // what the vendor answers, so that work has an acceptance test waiting rather than starting from a guess. They also
  // ask the question the symbol form cannot: ADD and MUL are EXTENSIBLE in IEC, so what does `ADD(a, b, c)` do?
  {
    name: "operator_call_form_arithmetic",
    deferred: { lsp: "2026-09-18: no LSP error for `ADD(a, b)` — the call form of an operator is IL, not ST" },
    refused: "';' expected instead of 'ADD'",
    pouName: "FB_LANG_operator_call_form_arithmetic",
    kind: "function_block" as const,
    feature: "ADD/SUB/MUL/DIV written as CALLS rather than symbols — accepted, and the same answers?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_arithmetic : FB_LANG_operator_call_form_arithmetic;",
    plcPrgBody: "inst_operator_call_form_arithmetic();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_arithmetic\nVAR\n\ta : INT := 12;\n\tb : INT := 4;\n\tadded : INT;\n\tsubbed : INT;\n\tmultiplied : INT;\n\tdivided : INT;\nEND_VAR\nadded := ADD(a, b);\nsubbed := SUB(a, b);\nmultiplied := MUL(a, b);\ndivided := DIV(a, b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operator_call_form_extensible",
    deferred: { lsp: "2026-09-18: no LSP error for as operator_call_form_arithmetic" },
    refused: "';' expected instead of 'ADD'",
    pouName: "FB_LANG_operator_call_form_extensible",
    kind: "function_block" as const,
    feature: "ADD and MUL are EXTENSIBLE — what does a THIRD argument do?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_extensible : FB_LANG_operator_call_form_extensible;",
    plcPrgBody: "inst_operator_call_form_extensible();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_extensible\nVAR\n\ta : INT := 2;\n\tb : INT := 3;\n\tc : INT := 4;\n\tadded3 : INT;\n\tmultiplied3 : INT;\nEND_VAR\nadded3 := ADD(a, b, c);\nmultiplied3 := MUL(a, b, c);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "operator_call_form_comparison",
    deferred: { lsp: "2026-09-18: no LSP error for a variable named `gt` — GT is a reserved operator name" },
    refused: "Unexpected token 'gt' found",
    pouName: "FB_LANG_operator_call_form_comparison",
    kind: "function_block" as const,
    feature: "GT/LT/LE/GE/EQ/NE written as CALLS rather than symbols",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_operator_call_form_comparison : FB_LANG_operator_call_form_comparison;",
    plcPrgBody: "inst_operator_call_form_comparison();",
    source: "FUNCTION_BLOCK FB_LANG_operator_call_form_comparison\nVAR\n\ta : INT := 12;\n\tb : INT := 4;\n\tgt : BOOL;\n\tlt : BOOL;\n\tle : BOOL;\n\tge : BOOL;\n\teq : BOOL;\n\tne : BOOL;\nEND_VAR\ngt := GT(a, b);\nlt := LT(a, b);\nle := LE(a, b);\nge := GE(a, b);\neq := EQ(a, b);\nne := NE(a, b);\nEND_FUNCTION_BLOCK\n",
  },
]
