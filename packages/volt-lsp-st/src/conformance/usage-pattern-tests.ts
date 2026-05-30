/**
 * Usage-pattern conformance tests.
 *
 * Complement to the doc-derived tests: each entry here is a self-
 * contained ST snippet whose PLC_PRG body contains idiomatic
 * member-access, call-site, or accessor patterns. Designed to fill
 * coverage gaps in the LSP corpus tests that need real usage
 * context — completion, signature-help, hover-on-callsite,
 * implementation, references, etc.
 *
 * Each test follows the same LanguageTest shape as the other catalog
 * files; `fromDoc` is set to "usage-pattern" since these aren't
 * tied to a single CODESYS reference doc.
 */
import type { LanguageTest } from "./types.js";

export const USAGE_PATTERN_TESTS: readonly LanguageTest[] = [
	// ── FB method / property usage ──────────────────────────────

	{
		name: "use_fb_method_call_no_args",
		pouName: "FB_LANG_use_method_no_args",
		kind: "function_block",
		feature: "Parameterless method called on an FB instance",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_umna : FB_LANG_use_method_no_args;",
		plcPrgBody: "fb_umna.Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_use_method_no_args
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
iCount := iCount + 1;
END_METHOD
`,
	},

	{
		name: "use_fb_method_call_one_input",
		pouName: "FB_LANG_use_method_one_input",
		kind: "function_block",
		feature: "Method with single VAR_INPUT called positionally",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_umoi : FB_LANG_use_method_one_input;",
		plcPrgBody: "fb_umoi.AddOne(5);",
		source:
`FUNCTION_BLOCK FB_LANG_use_method_one_input
VAR
	iSum : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD AddOne
VAR_INPUT
	iIn : INT;
END_VAR
iSum := iSum + iIn;
END_METHOD
`,
	},

	{
		name: "use_fb_method_call_named_args",
		pouName: "FB_LANG_use_method_named_args",
		kind: "function_block",
		feature: "Method with multiple inputs called with named args",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_umna2 : FB_LANG_use_method_named_args;",
		plcPrgBody: "fb_umna2.Configure(iWidth := 10, iHeight := 20);",
		source:
`FUNCTION_BLOCK FB_LANG_use_method_named_args
VAR
	iArea : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Configure
VAR_INPUT
	iWidth  : INT;
	iHeight : INT;
END_VAR
iArea := iWidth * iHeight;
END_METHOD
`,
	},

	{
		name: "use_fb_method_returns_value",
		pouName: "FB_LANG_use_method_returns_value",
		kind: "function_block",
		feature: "Method with return type used in assignment RHS",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_umrv : FB_LANG_use_method_returns_value;\n\tiResult : INT;",
		plcPrgBody: "iResult := fb_umrv.Compute(7);",
		source:
`FUNCTION_BLOCK FB_LANG_use_method_returns_value
END_FUNCTION_BLOCK

METHOD Compute : INT
VAR_INPUT
	iIn : INT;
END_VAR
Compute := iIn * 2;
END_METHOD
`,
	},

	{
		name: "use_fb_property_read",
		pouName: "FB_LANG_use_property_read",
		kind: "function_block",
		feature: "Read an FB property via dot-access",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_upr : FB_LANG_use_property_read;\n\tiOut : INT;",
		plcPrgBody: "iOut := fb_upr.Value;",
		source:
`FUNCTION_BLOCK FB_LANG_use_property_read
VAR
	iBacking : INT := 42;
END_VAR

END_FUNCTION_BLOCK

PROPERTY Value : INT
GET
Value := iBacking;
END_GET
END_PROPERTY
`,
	},

	{
		name: "use_fb_property_write",
		pouName: "FB_LANG_use_property_write",
		kind: "function_block",
		feature: "Write to an FB property via dot-access",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_upw : FB_LANG_use_property_write;",
		plcPrgBody: "fb_upw.Threshold := 100;",
		source:
`FUNCTION_BLOCK FB_LANG_use_property_write
VAR
	iThresholdBacking : INT;
END_VAR

END_FUNCTION_BLOCK

PROPERTY Threshold : INT
SET
iThresholdBacking := Threshold;
END_SET
END_PROPERTY
`,
	},

	{
		name: "use_fb_callable",
		pouName: "FB_LANG_use_callable",
		kind: "function_block",
		feature: "FB instance invoked like a function (FB body call)",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_uc : FB_LANG_use_callable;",
		plcPrgBody: "fb_uc(iIn := 3);",
		source:
`FUNCTION_BLOCK FB_LANG_use_callable
VAR_INPUT
	iIn : INT;
END_VAR
VAR
	iCount : INT;
END_VAR

iCount := iCount + iIn;
END_FUNCTION_BLOCK
`,
	},

	// ── DUT / GVL access ────────────────────────────────────────

	{
		name: "use_struct_member_access",
		pouName: "DUT_LANG_use_struct_member",
		kind: "structure",
		feature: "STRUCT field accessed via dot-notation in PLC_PRG",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "dut_usm : DUT_LANG_use_struct_member;",
		plcPrgBody: "dut_usm.iValue := 42;",
		source:
`TYPE DUT_LANG_use_struct_member :
STRUCT
	iValue : INT;
	bFlag  : BOOL;
END_STRUCT
END_TYPE
`,
	},

	{
		name: "use_struct_nested_member",
		pouName: "DUT_LANG_use_struct_outer",
		kind: "structure",
		feature: "Nested STRUCT field access (outer.inner.field)",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "dut_uso : DUT_LANG_use_struct_outer;",
		plcPrgBody: "dut_uso.inner.iValue := 1;",
		source:
`TYPE DUT_LANG_use_struct_inner :
STRUCT
	iValue : INT;
END_STRUCT
END_TYPE

TYPE DUT_LANG_use_struct_outer :
STRUCT
	inner : DUT_LANG_use_struct_inner;
END_STRUCT
END_TYPE
`,
	},

	{
		name: "use_gvl_field_access",
		pouName: "GVL_LANG_use_field_access",
		kind: "gvl",
		feature: "GVL field accessed via qualified dot-notation",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: undefined,
		plcPrgBody: "GVL_LANG_use_field_access.gValue := 99;",
		source:
`{attribute 'qualified_only'}
VAR_GLOBAL
	gValue : INT;
END_VAR
`,
	},

	// ── THIS^ / SUPER^ patterns ────────────────────────────────

	{
		name: "use_this_member_in_method",
		pouName: "FB_LANG_use_this_member",
		kind: "function_block",
		feature: "Method body uses THIS^.field to access the FB's own data",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_utm : FB_LANG_use_this_member;",
		plcPrgBody: "fb_utm.Bump();",
		source:
`FUNCTION_BLOCK FB_LANG_use_this_member
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Bump
THIS^.iCount := THIS^.iCount + 1;
END_METHOD
`,
	},

	// ── FUNCTION call ──────────────────────────────────────────

	{
		name: "use_function_call_with_arg",
		pouName: "FUN_LANG_use_function_call",
		kind: "function",
		feature: "Top-level FUNCTION called from PLC_PRG with an argument",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "iFcOut : INT;",
		plcPrgBody: "iFcOut := FUN_LANG_use_function_call(5);",
		source:
`FUNCTION FUN_LANG_use_function_call : INT
VAR_INPUT
	iIn : INT;
END_VAR

FUN_LANG_use_function_call := iIn * iIn;
END_FUNCTION
`,
	},

	// ── ARRAY OF FB / indexed call ────────────────────────────

	{
		name: "use_array_indexed_method_call",
		pouName: "FB_LANG_use_array_indexed",
		kind: "function_block",
		feature: "Method call on array element: arr[i].Method()",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "arr_uai : ARRAY[0..1] OF FB_LANG_use_array_indexed;",
		plcPrgBody: "arr_uai[0].Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_use_array_indexed
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
iCount := iCount + 1;
END_METHOD
`,
	},

	// ── Pointer deref + member ────────────────────────────────

	{
		name: "use_pointer_deref_struct_field",
		pouName: "FB_LANG_use_pointer_deref",
		kind: "function_block",
		feature: "POINTER TO STRUCT dereferenced + field access (pInst^.field)",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_upd : FB_LANG_use_pointer_deref;",
		plcPrgBody: "fb_upd.SetTarget();",
		source:
`FUNCTION_BLOCK FB_LANG_use_pointer_deref
VAR
	target : INT;
	pTarget : POINTER TO INT;
END_VAR

pTarget := ADR(target);
END_FUNCTION_BLOCK

METHOD SetTarget
pTarget^ := 42;
END_METHOD
`,
	},

	// ── Method body calls another method on same FB ────────────

	{
		name: "use_self_method_call",
		pouName: "FB_LANG_use_self_call",
		kind: "function_block",
		feature: "FB method body calls another method on the same FB",
		fromDoc: "usage-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_usc : FB_LANG_use_self_call;",
		plcPrgBody: "fb_usc.Outer();",
		source:
`FUNCTION_BLOCK FB_LANG_use_self_call
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inner
iValue := iValue + 1;
END_METHOD

METHOD Outer
THIS^.Inner();
END_METHOD
`,
	},
];
