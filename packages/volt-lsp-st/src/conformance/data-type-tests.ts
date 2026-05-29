/**
 * Data-type conformance tests — DUT shapes (STRUCT / UNION / ENUM /
 * ALIAS / SUBRANGE) and the BIT type.
 *
 * Source: 06-data-types.md.
 *
 * Each entry is a single DUT pushed as `.dut`. The recorder picks up
 * `kind: "structure"` and writes to `<name>.dut`. PLC_PRG instantiates
 * the type so TC analyses it (dead code is skipped by the compiler).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./types.js";

export const DATA_TYPE_TESTS: readonly LanguageTest[] = [
	// ─── STRUCT ─────────────────────────────────────────────────────────

	{
		name: "type_dut_struct_simple",
		pouName: "DUT_LANG_struct_simple",
		kind: "structure",
		feature: "STRUCT — simple record with two fields",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_simple : DUT_LANG_struct_simple;",
		plcPrgBody: "dut_simple.x := 42;\ndut_simple.y := 7;",
		source:
`TYPE DUT_LANG_struct_simple :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE
`,
	},

	{
		name: "type_dut_struct_extends",
		pouName: "DUT_LANG_struct_extends",
		kind: "structure",
		feature: "STRUCT EXTENDS — base + derived record",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		note: "Pure DUT inheritance — no FB involved. TC supports `EXTENDS DUT_Base` on struct DUTs.",
		plcPrgVar: "dut_ext : DUT_LANG_struct_extends;",
		plcPrgBody: "dut_ext.id := 1;\ndut_ext.label := 'hi';",
		source:
`TYPE DUT_LANG_struct_base :
STRUCT
	id : INT;
END_STRUCT
END_TYPE

TYPE DUT_LANG_struct_extends EXTENDS DUT_LANG_struct_base :
STRUCT
	label : STRING;
END_STRUCT
END_TYPE
`,
	},

	{
		name: "type_dut_struct_nested",
		pouName: "DUT_LANG_struct_nested",
		kind: "structure",
		feature: "STRUCT with a nested STRUCT field",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_nest : DUT_LANG_struct_nested;",
		plcPrgBody: "dut_nest.position.x := 10;",
		source:
`TYPE DUT_LANG_struct_inner :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE

TYPE DUT_LANG_struct_nested :
STRUCT
	position : DUT_LANG_struct_inner;
	speed : REAL;
END_STRUCT
END_TYPE
`,
	},

	// ─── ENUM ───────────────────────────────────────────────────────────

	{
		name: "type_dut_enum_simple",
		pouName: "DUT_LANG_enum_simple",
		kind: "structure",
		feature: "ENUM — simple value list (default INT base)",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_enum : DUT_LANG_enum_simple;",
		plcPrgBody: "dut_enum := DUT_LANG_enum_simple.Running;",
		source:
`TYPE DUT_LANG_enum_simple :
(
	Idle,
	Running,
	Halted
);
END_TYPE
`,
	},

	{
		name: "type_dut_enum_with_base",
		pouName: "DUT_LANG_enum_with_base",
		kind: "structure",
		feature: "ENUM with explicit BYTE base type",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_enum_b : DUT_LANG_enum_with_base;",
		plcPrgBody: "dut_enum_b := DUT_LANG_enum_with_base.LevelB;",
		source:
`TYPE DUT_LANG_enum_with_base :
(
	LevelA,
	LevelB,
	LevelC
) BYTE;
END_TYPE
`,
	},

	{
		name: "type_dut_enum_explicit_values",
		pouName: "DUT_LANG_enum_explicit_values",
		kind: "structure",
		feature: "ENUM with explicit value assignments",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_enum_e : DUT_LANG_enum_explicit_values;",
		plcPrgBody: "dut_enum_e := DUT_LANG_enum_explicit_values.Pressed;",
		source:
`TYPE DUT_LANG_enum_explicit_values :
(
	Released := 0,
	Pressed := 1,
	HeldLong := 2
);
END_TYPE
`,
	},

	// ─── ALIAS ──────────────────────────────────────────────────────────

	{
		name: "type_dut_alias_int",
		pouName: "DUT_LANG_alias_int",
		kind: "structure",
		feature: "ALIAS — UDINT alias",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_alias_id : DUT_LANG_alias_int;",
		plcPrgBody: "dut_alias_id := 1234;",
		source:
`TYPE DUT_LANG_alias_int : UDINT;
END_TYPE
`,
	},

	{
		name: "type_dut_alias_string",
		pouName: "DUT_LANG_alias_string",
		kind: "structure",
		feature: "ALIAS — STRING(80) alias",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_alias_str : DUT_LANG_alias_string;",
		plcPrgBody: "dut_alias_str := 'hello';",
		source:
`TYPE DUT_LANG_alias_string : STRING(80);
END_TYPE
`,
	},

	// ─── UNION ──────────────────────────────────────────────────────────

	{
		name: "type_dut_union",
		pouName: "DUT_LANG_union",
		kind: "structure",
		feature: "UNION — overlapping variants",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_u : DUT_LANG_union;",
		plcPrgBody: "dut_u.iWord := 16#ABCD;",
		source:
`TYPE DUT_LANG_union :
UNION
	iWord : WORD;
	aBytes : ARRAY[0..1] OF BYTE;
END_UNION
END_TYPE
`,
	},

	// ─── SUBRANGE ──────────────────────────────────────────────────────

	{
		name: "type_dut_subrange",
		pouName: "DUT_LANG_subrange",
		kind: "structure",
		feature: "SUBRANGE — INT constrained to 0..100",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "dut_pct : DUT_LANG_subrange := 50;",
		plcPrgBody: "dut_pct := 75;",
		source:
`TYPE DUT_LANG_subrange : INT(0..100);
END_TYPE
`,
	},

	// ─── BIT type ──────────────────────────────────────────────────────

	// ─── ANY / ANY_<type> generic parameters ────────────────────────────

	{
		name: "type_any_function_input",
		pouName: "FUN_LANG_any_input",
		kind: "function",
		feature: "ANY function input — accepts arbitrary typed argument (CODESYS generic)",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "ANY exposes the value as a struct {typeclass, pvalue, diSize}. TC support depends on __SYSTEM.AnyType being defined in the project. Catalog records recorded reality.",
		plcPrgVar: "iSrc : INT := 5;\niReturned : DINT;",
		plcPrgBody: "iReturned := FUN_LANG_any_input(iSrc);",
		source:
`FUNCTION FUN_LANG_any_input : DINT
VAR_INPUT
	anyArg : ANY;
END_VAR

FUN_LANG_any_input := anyArg.diSize;
END_FUNCTION
`,
	},

	{
		name: "type_any_int_function_input",
		pouName: "FUN_LANG_any_int",
		kind: "function",
		feature: "ANY_INT — restricts a generic input to integer-family types",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "ANY_<type> family (ANY_INT, ANY_NUM, ANY_BIT, ANY_REAL, ANY_DATE) narrows ANY to a type group. TC support varies.",
		plcPrgVar: "iSrc : INT := 5;\niReturned : DINT;",
		plcPrgBody: "iReturned := FUN_LANG_any_int(iSrc);",
		source:
`FUNCTION FUN_LANG_any_int : DINT
VAR_INPUT
	anyInt : ANY_INT;
END_VAR

FUN_LANG_any_int := anyInt.diSize;
END_FUNCTION
`,
	},

	// ─── CODESYS extension types (platform-dependent) ──────────────────

	{
		name: "type_codesys_xint",
		pouName: "FB_LANG_codesys_xint",
		kind: "function_block",
		feature: "__XINT — CODESYS platform-portable signed integer (16 / 32 / 64-bit per target)",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "CODESYS-only extension. TC support is platform-dependent — catalog records actual behavior.",
		plcPrgVar: "fb_xi : FB_LANG_codesys_xint;",
		plcPrgBody: "fb_xi.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_codesys_xint
VAR
	xValue : __XINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
xValue := 42;
END_METHOD
`,
	},

	{
		name: "type_codesys_uxint",
		pouName: "FB_LANG_codesys_uxint",
		kind: "function_block",
		feature: "__UXINT — CODESYS platform-portable unsigned integer",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "CODESYS-only extension. TC support platform-dependent.",
		plcPrgVar: "fb_ux : FB_LANG_codesys_uxint;",
		plcPrgBody: "fb_ux.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_codesys_uxint
VAR
	uxValue : __UXINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
uxValue := 42;
END_METHOD
`,
	},

	{
		name: "type_codesys_xword",
		pouName: "FB_LANG_codesys_xword",
		kind: "function_block",
		feature: "__XWORD — CODESYS platform-portable bitstring (pointer-sized)",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "CODESYS-only extension. Width matches platform pointer width.",
		plcPrgVar: "fb_xw : FB_LANG_codesys_xword;",
		plcPrgBody: "fb_xw.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_codesys_xword
VAR
	xwValue : __XWORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
xwValue := 16#FF;
END_METHOD
`,
	},

	{
		name: "type_codesys_vector",
		pouName: "FB_LANG_codesys_vector",
		kind: "function_block",
		feature: "__VECTOR — CODESYS-only SIMD type; TC rejects",
		fromDoc: "06-data-types.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live 2026-05-29): TC rejects `__VECTOR[N] OF T` with 'Type definition expected instead of __VECTOR'. CODESYS-only extension; TC has no SIMD primitive — use plain ARRAY[0..N-1] OF T. LSP parses the syntax (maps to array_type) so the user sees their code in the IDE; the vendor-only-operator check needs widening to include type-position keywords if we want LSP to flag this too.",
		plcPrgVar: "fb_v : FB_LANG_codesys_vector;",
		plcPrgBody: "fb_v.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_codesys_vector
VAR
	vec4 : __VECTOR[4] OF REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
vec4[0] := 1.0;
END_METHOD
`,
	},

{
		name: "type_codesys_version",
		pouName: "FB_LANG_codesys_version",
		kind: "function_block",
		feature: "VERSION — CODESYS library/POU version-metadata type",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "CODESYS metadata type. TC support depends on library-package machinery.",
		plcPrgVar: "fb_ver : FB_LANG_codesys_version;",
		plcPrgBody: "fb_ver.Inspect();",
		source:
`FUNCTION_BLOCK FB_LANG_codesys_version
VAR
	vTag : VERSION;
END_VAR

END_FUNCTION_BLOCK

METHOD Inspect
;
END_METHOD
`,
	},

	// ─── Implicit Enumeration (inline VAR-section variant) ─────────────

	{
		name: "type_implicit_enum_inline",
		pouName: "FB_LANG_implicit_enum",
		kind: "function_block",
		feature: "Implicit ENUM declared inline in a VAR section — no TYPE block",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		note: "CODESYS 'Implicit Enumeration' — inline `(Idle, Running, Halted)` as a variable's type. No TYPE/END_TYPE wrapper; the enum values are scoped to the FB.",
		plcPrgVar: "fb_ie : FB_LANG_implicit_enum;",
		plcPrgBody: "fb_ie.Step();",
		source:
`FUNCTION_BLOCK FB_LANG_implicit_enum
VAR
	eState : (Idle, Running, Halted) := Idle;
END_VAR

END_FUNCTION_BLOCK

METHOD Step
eState := Running;
END_METHOD
`,
	},

	{
		name: "type_dut_struct_with_bit_fields",
		pouName: "DUT_LANG_struct_bit_fields",
		kind: "structure",
		feature: "STRUCT with BIT fields — packed flags",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		note: "BIT is only allowed in STRUCT field declarations (not standalone VAR), per the CODESYS BIT page.",
		plcPrgVar: "dut_flags : DUT_LANG_struct_bit_fields;",
		plcPrgBody: "dut_flags.bFlagA := TRUE;",
		source:
`TYPE DUT_LANG_struct_bit_fields :
STRUCT
	bFlagA : BIT;
	bFlagB : BIT;
	bFlagC : BIT;
END_STRUCT
END_TYPE
`,
	},
];
