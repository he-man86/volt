/**
 * the fixtures of `data-type.ts` — part A: STRUCT; ENUM; ENUM DEFAULTS — what an uninitialized enum variable starts at; ALIAS; UNION; SUBRANGE; BIT type.
 *
 * One slice of `data-type.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { unionOverlay } from "./data-type-shared.js"

export const DATA_TYPE_TESTS_A: readonly LanguageTest[] = [
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
    plcPrgVar: "structBase : DUT_LANG_struct_base;",
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
    plcPrgVar: "structInner : DUT_LANG_struct_inner;",
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
  // A UNION's members of every measured kind overlaid, each stored both ways (transpile-restructure 7.8.4): signed
  // integers of two widths over a byte array, a REAL over a DWORD, an LREAL over eight bytes. Each a DUT of its own, so
  // one fixture's store reads only its own union.
  ...unionOverlay("int_dint_store_dint", "iv : INT;\n\tdv : DINT;\n\tbv : ARRAY[0..3] OF BYTE;", "u.dv := -2;"),
  ...unionOverlay("int_dint_store_int", "iv : INT;\n\tdv : DINT;\n\tbv : ARRAY[0..3] OF BYTE;", "u.dv := 16#11223344;\nu.iv := -2;"),
  ...unionOverlay("int_dint_store_bytes", "iv : INT;\n\tdv : DINT;\n\tbv : ARRAY[0..3] OF BYTE;", "u.dv := 1;\nu.bv[3] := 16#80;"),
  ...unionOverlay("real_dword_store_real", "rv : REAL;\n\twv : DWORD;", "u.rv := 1.5;"),
  ...unionOverlay("real_dword_store_dword", "rv : REAL;\n\twv : DWORD;", "u.wv := 16#C0490FDB;"),
  ...unionOverlay("lreal_bytes_store_lreal", "lv : LREAL;\n\tbv : ARRAY[0..7] OF BYTE;", "u.lv := -0.1;"),
  ...unionOverlay("lreal_bytes_store_bytes", "lv : LREAL;\n\tbv : ARRAY[0..7] OF BYTE;", "u.lv := 1.0;\nu.bv[7] := 16#40;\nu.bv[6] := 16#09;"),
  // arrays of elements wider than a byte, and a shorter member (two SINTs) beside two longer ones
  ...unionOverlay("dword_words_sints", "dv : DWORD;\n\twv : ARRAY[1..2] OF WORD;\n\tiv : ARRAY[0..1] OF SINT;", "u.dv := 16#1234FF80;\nu.wv[2] := 16#7F01;\nu.iv[1] := 5;"),
  // A UNION's size under `pack_mode` and its place inside a STRUCT (gate review of 7.8.4: both folded by the front-end's
  // rule, neither recorded). Packed, DWORD|ARRAY[0..4] OF BYTE is 5 if the attribute reaches a union, 8 if not. Unpacked
  // between two BYTEs, aligned to its DWORD: u at 4, c at 12, SIZEOF 16.
  {
    name: "type_dut_union_pack_mode",
    pouName: "DUT_LANG_union_pack_mode",
    kind: "dut",
    feature: "UNION — SIZEOF with {attribute 'pack_mode' := '1'}",
    fromDoc: "06-data-types.md",
    plcPrgVar: "u : DUT_LANG_union_pack_mode; n : UDINT;",
    plcPrgBody: "n := SIZEOF(u);\nu.d := 16#01020304;",
    source: "{attribute 'pack_mode' := '1'}\nTYPE DUT_LANG_union_pack_mode :\nUNION\n\td : DWORD;\n\tb : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n",
  },
  {
    name: "type_dut_union_in_struct",
    pouName: "DUT_LANG_union_in_struct",
    kind: "dut",
    feature: "UNION — as a STRUCT field between two BYTEs: its offset, the next field's, the struct's SIZEOF",
    fromDoc: "06-data-types.md",
    plcPrgVar: "sv : DUT_LANG_union_in_struct; n : UDINT; offU : ULINT; offC : ULINT;",
    plcPrgBody: "n := SIZEOF(sv);\noffU := ADR(sv.u) - ADR(sv);\noffC := ADR(sv.c) - ADR(sv);\nsv.u.d := 16#01020304;",
    source:
      "TYPE DUT_LANG_union_in_struct_u :\nUNION\n\td : DWORD;\n\tb : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_union_in_struct :\nSTRUCT\n\ta : BYTE;\n\tu : DUT_LANG_union_in_struct_u;\n\tc : BYTE;\nEND_STRUCT\nEND_TYPE\n",
  },
  // ─── SUBRANGE ──────────────────────────────────────────────────────

  {
    name: "type_dut_subrange",
    execSkip: "the online read refuses a subrange: \"Type 'Subrange' is not a literal type.\" (measured 2026-09-14) — there is no value the IDE will hand back",
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
]
