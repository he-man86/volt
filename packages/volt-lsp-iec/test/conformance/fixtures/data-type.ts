/**
 * Data-type conformance tests — DUT shapes (STRUCT / UNION / ENUM /
 * ALIAS / SUBRANGE) and the BIT type.
 *
 * Source: 06-data-types.md.
 *
 * Each entry is a single DUT (`kind: "dut"`) materialized as one
 * kind-named file (a DUT under its subtype — `.struct`/`.enum`/`.union`/`.alias`), like every writable source kind. PLC_PRG instantiates the
 * type so TC analyses it (dead code is skipped by the compiler).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js"

export const DATA_TYPE_TESTS: readonly LanguageTest[] = [
  // ─── STRUCT ─────────────────────────────────────────────────────────

  {
    name: "type_dut_struct_simple",
    pouName: "DUT_LANG_struct_simple",
    kind: "dut",
    feature: "STRUCT — simple record with two fields",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_simple : DUT_LANG_struct_simple;",
    plcPrgBody: "dut_simple.x := 42;\ndut_simple.y := 7;",
    source: `TYPE DUT_LANG_struct_simple :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE
`,
  },

  // STRUCT EXTENDS and nested STRUCT are modeled as SEPARATE DUT items (base/inner get their own
  // fixture) — CODESYS is one-DUT-per-item: two `TYPE…END_TYPE` blocks in one item is "Unexpected
  // statement". The derived/outer references the base/inner by name; the recorder's dep scan pushes
  // each as its own item, and the replay resolves the reference via the cross-test decl set.
  {
    name: "type_dut_struct_base",
    pouName: "DUT_LANG_struct_base",
    kind: "dut",
    feature: "STRUCT base record — extended by type_dut_struct_extends",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_struct_base :
STRUCT
	id : INT;
	code : INT;
END_STRUCT
END_TYPE
`,
  },

  {
    name: "type_dut_struct_extends",
    pouName: "DUT_LANG_struct_extends",
    kind: "dut",
    feature: "STRUCT EXTENDS — derived record over a separate base DUT item",
    fromDoc: "06-data-types.md",
    note: "Pure DUT inheritance — no FB involved. Both CODESYS (doc 06 L299) and TC support `EXTENDS DUT_Base`. Base is a separate item (DUT_LANG_struct_base).",
    plcPrgVar: "dut_ext : DUT_LANG_struct_extends;",
    plcPrgBody: "dut_ext.id := 1;\ndut_ext.label := 'hi';",
    source: `TYPE DUT_LANG_struct_extends EXTENDS DUT_LANG_struct_base :
STRUCT
	label : STRING;
	seq : INT;
END_STRUCT
END_TYPE
`,
  },

  {
    name: "type_dut_struct_inner",
    pouName: "DUT_LANG_struct_inner",
    kind: "dut",
    feature: "STRUCT inner record — nested inside type_dut_struct_nested",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_struct_inner :
STRUCT
	x : INT;
	y : INT;
END_STRUCT
END_TYPE
`,
  },

  {
    name: "type_dut_struct_nested",
    pouName: "DUT_LANG_struct_nested",
    kind: "dut",
    feature: "STRUCT with a nested STRUCT field (separate inner DUT item)",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_nest : DUT_LANG_struct_nested;",
    plcPrgBody: "dut_nest.position.x := 10;",
    source: `TYPE DUT_LANG_struct_nested :
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
    kind: "dut",
    feature: "ENUM — simple value list (default INT base)",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_enum : DUT_LANG_enum_simple;",
    plcPrgBody: "dut_enum := DUT_LANG_enum_simple.Running;",
    source: `TYPE DUT_LANG_enum_simple :
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
    kind: "dut",
    feature: "ENUM with explicit BYTE base type",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_enum_b : DUT_LANG_enum_with_base;",
    plcPrgBody: "dut_enum_b := DUT_LANG_enum_with_base.LevelB;",
    source: `TYPE DUT_LANG_enum_with_base :
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
    kind: "dut",
    feature: "ENUM with explicit value assignments",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_enum_e : DUT_LANG_enum_explicit_values;",
    plcPrgBody: "dut_enum_e := DUT_LANG_enum_explicit_values.Pressed;",
    source: `TYPE DUT_LANG_enum_explicit_values :
(
	Released := 0,
	Pressed := 1,
	HeldLong := 2
);
END_TYPE
`,
  },

  // ─── ENUM DEFAULTS — what an uninitialized enum variable starts at ──────────────────────────────────
  // A variable of an enum starts at its FIRST enumerator, so `(Reverse := -1, Neutral := 0)` starts at -1; lowering
  // started every enum at 0, which for that shape is not even a value of the type. 446 corpus enum types declare a
  // non-zero first enumerator, 21 of them in project source. NOTHING measured it — every enum fixture above starts at
  // 0 and assigns explicitly — so `enumStorage` refuses the shape (`enum-default`) rather than guessing. These record
  // the answer: the plain case, a negative first, the implicit baseline, a 0 that is NOT first, the type-level
  // default, and the inline enum that never reaches the named-type path.
  {
    name: "type_enum_default_first_nonzero",
    pouName: "FB_LANG_type_enum_default_first_nonzero",
    kind: "function_block" as const,
    feature: "a variable of an ENUM whose first enumerator is not 0 — what does it start at?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_type_enum_default_first_nonzero : FB_LANG_type_enum_default_first_nonzero;",
    plcPrgBody: "inst_type_enum_default_first_nonzero();",
    source: "TYPE DUT_LANG_enum_default_first_nonzero :\n(\n\tForward := 1,\n\tReverse := 2\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_type_enum_default_first_nonzero\nVAR\n\te : DUT_LANG_enum_default_first_nonzero;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "type_enum_default_first_negative",
    pouName: "FB_LANG_type_enum_default_first_negative",
    kind: "function_block" as const,
    feature: "a variable of an ENUM whose first enumerator is negative (bakon-nano sState := -1)",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_type_enum_default_first_negative : FB_LANG_type_enum_default_first_negative;",
    plcPrgBody: "inst_type_enum_default_first_negative();",
    source: "TYPE DUT_LANG_enum_default_first_negative :\n(\n\tReverse := -1,\n\tNeutral := 0,\n\tForward := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_type_enum_default_first_negative\nVAR\n\te : DUT_LANG_enum_default_first_negative;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "type_enum_default_first_implicit_zero",
    pouName: "FB_LANG_type_enum_default_first_implicit_zero",
    kind: "function_block" as const,
    feature: "a variable of an ENUM with no written values — the baseline the three above are read against",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_type_enum_default_first_implicit_zero : FB_LANG_type_enum_default_first_implicit_zero;",
    plcPrgBody: "inst_type_enum_default_first_implicit_zero();",
    source: "TYPE DUT_LANG_enum_default_first_implicit_zero :\n(\n\tIdle,\n\tBusy\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_type_enum_default_first_implicit_zero\nVAR\n\te : DUT_LANG_enum_default_first_implicit_zero;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "type_enum_default_gap_then_zero",
    pouName: "FB_LANG_type_enum_default_gap_then_zero",
    kind: "function_block" as const,
    feature: "an ENUM whose FIRST enumerator is non-zero but which HAS a 0 member later — is the default the first, or 0?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_type_enum_default_gap_then_zero : FB_LANG_type_enum_default_gap_then_zero;",
    plcPrgBody: "inst_type_enum_default_gap_then_zero();",
    source: "TYPE DUT_LANG_enum_default_gap_then_zero :\n(\n\tHigh := 10,\n\tNone := 0\n);\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_type_enum_default_gap_then_zero\nVAR\n\te : DUT_LANG_enum_default_gap_then_zero;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "type_enum_type_level_default",
    pouName: "FB_LANG_enum_type_level_default",
    kind: "function_block" as const,
    feature: "an ENUM declaring a type-level default (`TYPE E : (A, B) := B`) — where does a variable start?",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_enum_type_level_default : FB_LANG_enum_type_level_default;",
    plcPrgBody: "inst_enum_type_level_default();",
    source: "TYPE DUT_LANG_enum_type_level_default :\n(\n\tIdle := 0,\n\tBusy := 1\n) := Busy;\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_enum_type_level_default\nVAR\n\te : DUT_LANG_enum_type_level_default;\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "type_enum_inline_default_first_nonzero",
    pouName: "FB_LANG_enum_inline_default_first_nonzero",
    kind: "function_block" as const,
    feature: "an INLINE enum whose first enumerator is not 0 — the same default question, off the named-type path",
    fromDoc: "06-data-types.md",
    plcPrgVar: "inst_enum_inline_default : FB_LANG_enum_inline_default_first_nonzero;",
    plcPrgBody: "inst_enum_inline_default();",
    source: "FUNCTION_BLOCK FB_LANG_enum_inline_default_first_nonzero\nVAR\n\te : (Forward := 1, Reverse := 2);\n\tx : DINT;\nEND_VAR\nx := e;\nEND_FUNCTION_BLOCK\n",
  },

  // ─── ALIAS ──────────────────────────────────────────────────────────

  {
    name: "type_dut_alias_int",
    pouName: "DUT_LANG_alias_int",
    kind: "dut",
    feature: "ALIAS — UDINT alias",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_alias_id : DUT_LANG_alias_int;",
    plcPrgBody: "dut_alias_id := 1234;",
    source: `TYPE DUT_LANG_alias_int : UDINT;
END_TYPE
`,
  },

  {
    name: "type_dut_alias_string",
    pouName: "DUT_LANG_alias_string",
    kind: "dut",
    feature: "ALIAS — STRING(80) alias",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_alias_str : DUT_LANG_alias_string;",
    plcPrgBody: "dut_alias_str := 'hello';",
    source: `TYPE DUT_LANG_alias_string : STRING(80);
END_TYPE
`,
  },

  // ─── UNION ──────────────────────────────────────────────────────────

  {
    name: "type_dut_union",
    pouName: "DUT_LANG_union",
    kind: "dut",
    feature: "UNION — overlapping variants",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_u : DUT_LANG_union;",
    plcPrgBody: "dut_u.iWord := 16#ABCD;",
    source: `TYPE DUT_LANG_union :
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
    kind: "dut",
    feature: "SUBRANGE — INT constrained to 0..100",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_pct : DUT_LANG_subrange := 50;",
    plcPrgBody: "dut_pct := 75;",
    source: `TYPE DUT_LANG_subrange : INT(0..100);
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
    note: "ANY exposes the value as a struct {typeclass, pvalue, diSize}. TC support depends on __SYSTEM.AnyType being defined in the project. Catalog records recorded reality.",
    plcPrgVar: "iSrc : INT := 5;\niReturned : DINT;",
    plcPrgBody: "iReturned := FUN_LANG_any_input(iSrc);",
    source: `FUNCTION FUN_LANG_any_input : DINT
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
    note: "ANY_<type> family (ANY_INT, ANY_NUM, ANY_BIT, ANY_REAL, ANY_DATE) narrows ANY to a type group. TC support varies.",
    plcPrgVar: "iSrc : INT := 5;\niReturned : DINT;",
    plcPrgBody: "iReturned := FUN_LANG_any_int(iSrc);",
    source: `FUNCTION FUN_LANG_any_int : DINT
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
    note: "CODESYS-only extension. TC support is platform-dependent — catalog records actual behavior.",
    plcPrgVar: "fb_xi : FB_LANG_codesys_xint;",
    plcPrgBody: "fb_xi.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_xint
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
    note: "CODESYS-only extension. TC support platform-dependent.",
    plcPrgVar: "fb_ux : FB_LANG_codesys_uxint;",
    plcPrgBody: "fb_ux.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_uxint
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
    note: "CODESYS-only extension. Width matches platform pointer width.",
    plcPrgVar: "fb_xw : FB_LANG_codesys_xword;",
    plcPrgBody: "fb_xw.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_xword
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
    note: "DISCOVERY (verified live 2026-05-29): TC rejects `__VECTOR[N] OF T` with 'Type definition expected instead of __VECTOR'. CODESYS-only extension; TC has no SIMD primitive — use plain ARRAY[0..N-1] OF T. LSP parses the syntax (maps to array_type) so the user sees their code in the IDE; the vendor-only-operator check needs widening to include type-position keywords if we want LSP to flag this too.",
    plcPrgVar: "fb_v : FB_LANG_codesys_vector;",
    plcPrgBody: "fb_v.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_vector
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
    note: "CODESYS metadata type. TC support depends on library-package machinery.",
    plcPrgVar: "fb_ver : FB_LANG_codesys_version;",
    plcPrgBody: "fb_ver.Inspect();",
    source: `FUNCTION_BLOCK FB_LANG_codesys_version
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
    note: "CODESYS 'Implicit Enumeration' — inline `(Idle, Running, Halted)` as a variable's type. No TYPE/END_TYPE wrapper; the enum values are scoped to the FB.",
    plcPrgVar: "fb_ie : FB_LANG_implicit_enum;",
    plcPrgBody: "fb_ie.Step();",
    source: `FUNCTION_BLOCK FB_LANG_implicit_enum
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
    kind: "dut",
    feature: "STRUCT with BIT fields — packed flags",
    fromDoc: "06-data-types.md",
    note: "BIT is only allowed in STRUCT field declarations (not standalone VAR), per the CODESYS BIT page.",
    plcPrgVar: "dut_flags : DUT_LANG_struct_bit_fields;",
    plcPrgBody: "dut_flags.bFlagA := TRUE;",
    source: `TYPE DUT_LANG_struct_bit_fields :
STRUCT
	bFlagA : BIT;
	bFlagB : BIT;
	bFlagC : BIT;
END_STRUCT
END_TYPE
`,
  },

  // ─── Coverage extension for dut.ts:211-218 (alias init body) ──
  // STRUCT EXTENDS is already covered by `type_dut_struct_extends`
  // above; remaining gap in dut.ts is the alias-with-init path.

  {
    name: "type_dut_alias_with_init",
    pouName: "DUT_LANG_alias_with_init",
    kind: "dut",
    feature: "TYPE alias with initial value — alias body init path in DUT parser",
    fromDoc: "06-data-types.md",
    plcPrgVar: "dut_awi : DUT_LANG_alias_with_init;",
    plcPrgBody: "dut_awi := dut_awi + 1;",
    source: `TYPE DUT_LANG_alias_with_init : INT := 42;
END_TYPE
`,
  },
]
