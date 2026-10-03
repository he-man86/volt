/**
 * DERIVED TYPES — design.md §4 4.7 of openspec `frontend-conformance` (DT3–DT6; tasks 4.7.1–4.7.3), the cells no recorded
 * fixture decided. DT5 (an enum's default) has its own (`type_enum_default_*`).
 *
 *   DT3   a SUBRANGE in the Type: the type of arithmetic on one, the type a subrange variable is named as, and a constant
 *         out of range stored into a STRUCT member of a subrange type (the check read the declaration of a bare name)
 *   DT4   a UNION in the Type: SIZEOF of unions of differently sized members, and a member written through another
 *   DT6   an ENUM's STORAGE: SIZEOF of an enum with a written BYTE base, without a base, of an implicit enum and of a
 *         library enum (Util's WEEKDAY)
 *
 * Task 4.7.4 (DT1, DT2, DT7–DT11), the cells the fixtures the rows name did not separate:
 *
 *   DT1   an ALIAS: the name a variable of one (and of an alias of one) is given, its narrowing named, an alias of a
 *         STRUCT and of an ARRAY read through
 *   DT2   an alias's INITIALIZER: inherited through an alias of it, overridden by one, out of its base's range, of
 *         another type, narrowing
 *   DT7   THIS and SUPER as values: the type each is named as, with and without `^`; THIS into a pointer
 *   DT8   a STATIC BASE as a value — the name of a GVL, a STRUCT, an FB type, a FUNCTION, a PROGRAM, a namespace and an
 *         INTERFACE stored into a STRING — and a method called through an interface's name
 *   DT9   a PROGRAM and an interface's method called positionally
 *   DT10  the names of the derived types the recorded rows did not render: an array of several dimensions, of strings
 *         and of arrays, a string's capacity, the date and time types, a pointer to a pointer
 *   DT11  a string literal's name: empty, with an escape, a WSTRING literal, and a STRING CONSTANT
 *
 * No variable is called `st`: ST is an IL operator and cannot name one (the first recording, 2026-10-03, was a parse
 * cascade). The type-naming probes assign into a STRING, which none of these converts into, so the compiler names the type it arrived
 * at. A size is probed as an array bound — `ARRAY[1..SIZEOF(x)]` with element 100 written, which the compiler refuses
 * naming the range — and read back by the value twins (`*_values`), which run on CODESYS.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.7 (derived types); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The size probe: `x` (declared `decl`) and `a : ARRAY[1..SIZEOF(x)] OF BYTE`, element 100 written. */
function sizeBound(name: string, feature: string, decl: string, before = ""): LanguageTest {
  return fb(name, feature, `\tx : ${decl};\n\ta : ARRAY[1..SIZEOF(x)] OF BYTE;`, "a[100] := 0;", before)
}

// ─── DT3 — subrange ────────────────────────────────────────────────────────────────────────────────────────────────

const DT3: LanguageTest[] = [
  fb("dt_subrange_arithmetic_result", "DT3 — `v + 1` and `w * 2` (v an INT(0..10), w a UINT(0..10)) assigned to STRINGs",
    "\tv : INT(0..10) := 10;\n\tw : UINT(0..10) := 7;\n\ttxt1 : STRING;\n\ttxt2 : STRING;", "txt1 := v + 1;\ntxt2 := w * 2;"),
  fb("dt_subrange_arithmetic_result_values", "DT3 — `v + 1` (v an INT(0..10) holding 10) and `w * 2` (w a UINT(0..10) holding 7), read back",
    "\tv : INT(0..10) := 10;\n\tw : UINT(0..10) := 7;\n\tr1 : INT;\n\tr2 : DINT;", "r1 := v + 1;\nr2 := w * 2;"),
  fb("dt_subrange_variable_type", "DT3 — a variable of INT(0..10) and one of UINT(0..10) assigned to STRINGs",
    "\tv : INT(0..10);\n\tw : UINT(0..10);\n\ttxt1 : STRING;\n\ttxt2 : STRING;", "txt1 := v;\ntxt2 := w;"),
  fb("dt_subrange_member_assign", "DT3 — 20 stored into a STRUCT member of type INT(0..10), and 5",
    "\trec : DUT_LANG_dt_subrange_member_assign;", "rec.f := 20;\nrec.f := 5;",
    "TYPE DUT_LANG_dt_subrange_member_assign :\nSTRUCT\n\tf : INT(0..10);\nEND_STRUCT\nEND_TYPE\n\n"),
  // CODESYS names the target of `v := 200` (v an INT(1..100)) `INT (INT#1..100)` (`subrange_assign_const_out`) and of
  // `rec.f := 20` (f an INT(0..10)) `INT (0..10)`: the target's kind or the lower bound's value — each crossed
  fb("dt_subrange_assign_zero_lower", "DT3 — 20 stored into a variable of type INT(0..10)", "\tv : INT(0..10);", "v := 20;"),
  fb("dt_subrange_assign_negative_lower", "DT3 — 20 stored into a variable of type INT(-10..10), and into one of UINT(1..10)",
    "\tv : INT(-10..10);\n\tw : UINT(1..10);", "v := 20;\nw := 20;"),
  fb("dt_subrange_member_assign_nonzero_lower", "DT3 — 20 stored into a STRUCT member of type INT(1..10)",
    "\trec : DUT_LANG_dt_subrange_member_assign_nonzero_lower;", "rec.f := 20;",
    "TYPE DUT_LANG_dt_subrange_member_assign_nonzero_lower :\nSTRUCT\n\tf : INT(1..10);\nEND_STRUCT\nEND_TYPE\n\n"),
  // step 4d review: only CONSTANT sources were recorded into a subrange target — the name a VARIABLE source's mismatch
  // gives the target (the declaration form `UINT (1..10)` or the assignment form `UINT (UINT#1..10)`), and whether a
  // reference to the base binds a subrange variable, were never asked
  fb("dt_subrange_assign_variable", "DT3 — a STRING and a DINT variable stored into variables of type INT(0..10) and UINT(1..10)",
    "\tv : INT(0..10);\n\tw : UINT(1..10);\n\td : DINT;\n\ttxt : STRING;", "v := txt;\nw := txt;\nv := d;\nw := d;"),
  fb("dt_subrange_ref_bind", "DT3 — a REFERENCE TO INT bound to an INT(0..10) variable, and a REFERENCE TO UINT to a UINT(1..10)",
    "\tv : INT(0..10);\n\tw : UINT(1..10);\n\trv : REFERENCE TO INT;\n\trw : REFERENCE TO UINT;", "rv REF= v;\nrw REF= w;"),
]

// ─── DT4 — union ───────────────────────────────────────────────────────────────────────────────────────────────────

const UNIONS = (name: string): string =>
  `TYPE DUT_LANG_${name}_u1 :\nUNION\n\tb : BYTE;\n\td : DWORD;\nEND_UNION\nEND_TYPE\n\n` +
  `TYPE DUT_LANG_${name}_u2 :\nUNION\n\tb : BYTE;\n\tarr : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n\n` +
  `TYPE DUT_LANG_${name}_u3 :\nUNION\n\tl : LREAL;\n\ti : INT;\nEND_UNION\nEND_TYPE\n\n`

const DT4: LanguageTest[] = [
  fb("dt_union_member_sizes", "DT4 — SIZEOF of three unions (BYTE|DWORD, BYTE|ARRAY[0..4] OF BYTE, LREAL|INT), and a DWORD read back through the BYTE",
    "\tu1 : DUT_LANG_dt_union_member_sizes_u1;\n\tu2 : DUT_LANG_dt_union_member_sizes_u2;\n\tu3 : DUT_LANG_dt_union_member_sizes_u3;\n" +
      "\tn1 : UDINT;\n\tn2 : UDINT;\n\tn3 : UDINT;\n\tlow : BYTE;",
    "n1 := SIZEOF(u1);\nn2 := SIZEOF(u2);\nn3 := SIZEOF(u3);\nu1.d := 16#01020304;\nlow := u1.b;", UNIONS("dt_union_member_sizes")),
  fb("dt_union_sizeof_type", "DT4 — SIZEOF of a union (BYTE|DWORD) and a union member, assigned to STRINGs",
    "\tu1 : DUT_LANG_dt_union_sizeof_type_u1;\n\ttxt1 : STRING;\n\ttxt2 : STRING;", "txt1 := SIZEOF(u1);\ntxt2 := u1.d;",
    UNIONS("dt_union_sizeof_type")),
  // SIZEOF of the 4-byte union is a UINT where SIZEOF of a 4-byte DINT is a USINT (`ar_sizeof_type`): which sized things
  // take which width — a one-byte STRUCT, a one-byte UNION, an enum, an implicit enum, an alias of INT, an ARRAY[0..0] OF BYTE
  fb("dt_sizeof_derived_type", "DT4 — SIZEOF of a one-byte STRUCT, a one-byte UNION, an enum, an implicit enum, an alias of INT and an ARRAY[0..0] OF BYTE, into STRINGs",
    "\tsv : DUT_LANG_dt_sizeof_derived_type_s;\n\tuv : DUT_LANG_dt_sizeof_derived_type_u;\n\tev : DUT_LANG_dt_sizeof_derived_type_e;\n" +
      "\tiv : (Ia, Ib);\n\tav : DUT_LANG_dt_sizeof_derived_type_a;\n\tbv : ARRAY[0..0] OF BYTE;\n" +
      "\ttxt1 : STRING;\n\ttxt2 : STRING;\n\ttxt3 : STRING;\n\ttxt4 : STRING;\n\ttxt5 : STRING;\n\ttxt6 : STRING;",
    "txt1 := SIZEOF(sv);\ntxt2 := SIZEOF(uv);\ntxt3 := SIZEOF(ev);\ntxt4 := SIZEOF(iv);\ntxt5 := SIZEOF(av);\ntxt6 := SIZEOF(bv);",
    "TYPE DUT_LANG_dt_sizeof_derived_type_s :\nSTRUCT\n\tb : BYTE;\nEND_STRUCT\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_dt_sizeof_derived_type_u :\nUNION\n\tb : BYTE;\n\tc : USINT;\nEND_UNION\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_dt_sizeof_derived_type_e :\n(\n\tA,\n\tB\n);\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_dt_sizeof_derived_type_a : INT;\nEND_TYPE\n\n"),
  sizeBound("dt_union_sizeof_bound", "DT4 — SIZEOF of a union (BYTE|DWORD) as an array bound", "DUT_LANG_dt_union_sizeof_bound_u1",
    UNIONS("dt_union_sizeof_bound")),
  sizeBound("dt_union_array_sizeof_bound", "DT4 — SIZEOF of a union (BYTE|ARRAY[0..4] OF BYTE) as an array bound", "DUT_LANG_dt_union_array_sizeof_bound_u2",
    UNIONS("dt_union_array_sizeof_bound")),
  // step 4d review: a WSTRING's alignment — 1 as a STRING's, or 2 as its code units — decides this union's size (5 or 6)
  sizeBound("dt_union_wstring_sizeof_bound", "DT4 — SIZEOF of a union (WSTRING(1)|ARRAY[0..4] OF BYTE) as an array bound",
    "DUT_LANG_dt_union_wstring_sizeof_bound",
    "TYPE DUT_LANG_dt_union_wstring_sizeof_bound :\nUNION\n\tw : WSTRING(1);\n\tarr : ARRAY[0..4] OF BYTE;\nEND_UNION\nEND_TYPE\n\n"),
]

// ─── DT6 — enum storage ────────────────────────────────────────────────────────────────────────────────────────────

const BYTE_ENUM = (name: string): string => `TYPE DUT_LANG_${name} :\n(\n\tA,\n\tB := 200\n) BYTE;\nEND_TYPE\n\n`
const PLAIN_ENUM = (name: string): string => `TYPE DUT_LANG_${name} :\n(\n\tA,\n\tB\n);\nEND_TYPE\n\n`

const DT6: LanguageTest[] = [
  sizeBound("dt_enum_base_byte_storage", "DT6 — SIZEOF of an enum with a written BYTE base, as an array bound", "DUT_LANG_dt_enum_base_byte_storage",
    BYTE_ENUM("dt_enum_base_byte_storage")),
  fb("dt_enum_base_byte_storage_values", "DT6 — SIZEOF of an enum with a written BYTE base, and its value 200 read back through TO_BYTE",
    "\te : DUT_LANG_dt_enum_base_byte_storage_values;\n\tn : UDINT;\n\tb : BYTE;",
    "n := SIZEOF(e);\ne := DUT_LANG_dt_enum_base_byte_storage_values.B;\nb := TO_BYTE(e);", BYTE_ENUM("dt_enum_base_byte_storage_values")),
  sizeBound("dt_enum_plain_storage", "DT6 — SIZEOF of a project enum without a base, as an array bound", "DUT_LANG_dt_enum_plain_storage",
    PLAIN_ENUM("dt_enum_plain_storage")),
  sizeBound("dt_enum_implicit_storage", "DT6 — SIZEOF of an implicit enum `(Ia, Ib)`, as an array bound", "(Ia, Ib)"),
  {
    ...sizeBound("dt_library_enum_storage", "DT6 — SIZEOF of Util's WEEKDAY (a library enum), as an array bound", "WEEKDAY"),
    deferred: {
      lsp: "2026-10-03, CODESYS stores WEEKDAY in 2 bytes, a base its materialized declaration does not carry (`types/enums` `enumStorage` leaves a library enum's storage unknown); `LIBRARY_ENUM_BASE_NOT_MATERIALIZED`",
    },
  },
  fb("dt_library_enum_storage_values", "DT6 — SIZEOF of Util's WEEKDAY (a library enum), read back", "\tw : WEEKDAY;\n\tn : UDINT;", "n := SIZEOF(w);"),
]

// ─── DT1/DT2 — aliases (task 4.7.4) ────────────────────────────────────────────────────────────────────────────────

/** `TYPE DUT_LANG_<name>_<suffix> : <body>; END_TYPE`. */
const alias = (name: string, suffix: string, body: string): string => `TYPE DUT_LANG_${name}_${suffix} : ${body};\nEND_TYPE\n\n`

const DT1: LanguageTest[] = [
  fb("dt_alias_type_name", "DT1 — a variable of an alias of INT, and one of an alias of that alias, assigned to STRINGs",
    "\ta : DUT_LANG_dt_alias_type_name_a;\n\tb : DUT_LANG_dt_alias_type_name_b;\n\ttxt1 : STRING;\n\ttxt2 : STRING;", "txt1 := a;\ntxt2 := b;",
    alias("dt_alias_type_name", "a", "INT") + alias("dt_alias_type_name", "b", "DUT_LANG_dt_alias_type_name_a")),
  fb("dt_alias_narrowing_name", "DT1 — a variable of an alias of INT stored into a SINT, and an alias of LREAL into a REAL",
    "\ta : DUT_LANG_dt_alias_narrowing_name_a;\n\tl : DUT_LANG_dt_alias_narrowing_name_l;\n\tsv : SINT;\n\trv : REAL;", "sv := a;\nrv := l;",
    alias("dt_alias_narrowing_name", "a", "INT") + alias("dt_alias_narrowing_name", "l", "LREAL")),
  fb("dt_alias_struct_and_array_values", "DT1 — a member written and read through an alias of a STRUCT, an element through an alias of an ARRAY",
    "\tsa : DUT_LANG_dt_alias_struct_and_array_values_as;\n\ta : DUT_LANG_dt_alias_struct_and_array_values_aa;\n\tr1 : INT;\n\tr2 : INT;",
    "sa.x := INT#5;\na[1] := INT#7;\nr1 := sa.x;\nr2 := a[1];",
    "TYPE DUT_LANG_dt_alias_struct_and_array_values_s :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n" +
      alias("dt_alias_struct_and_array_values", "as", "DUT_LANG_dt_alias_struct_and_array_values_s") +
      alias("dt_alias_struct_and_array_values", "aa", "ARRAY[0..2] OF INT")),
]

/** Why the LSP says nothing of an alias's initializer (`support/divergences.ts` `ALIAS_INITIALIZER_NOT_CHECKED`). */
const ALIAS_INITIALIZER_UNCHECKED =
  "2026-10-03, both vendors check an alias's initializer as a store into its base, as often as the alias is used (never unused); the LSP does not — niche: accepted loss (0 occurrences in the corpora); `ALIAS_INITIALIZER_NOT_CHECKED`"

const DT2: LanguageTest[] = [
  fb("dt_alias_of_alias_init", "DT2 — an alias of INT := 42, an alias of it without an initializer and one with := 7, variables of each read",
    "\tv1 : DUT_LANG_dt_alias_of_alias_init_a1;\n\tv2 : DUT_LANG_dt_alias_of_alias_init_a2;\n\tv3 : DUT_LANG_dt_alias_of_alias_init_a3;\n\tr1 : INT;\n\tr2 : INT;\n\tr3 : INT;",
    "r1 := v1;\nr2 := v2;\nr3 := v3;",
    alias("dt_alias_of_alias_init", "a1", "INT := 42") + alias("dt_alias_of_alias_init", "a2", "DUT_LANG_dt_alias_of_alias_init_a1") +
      alias("dt_alias_of_alias_init", "a3", "DUT_LANG_dt_alias_of_alias_init_a1 := 7")),
  {
    ...fb("dt_alias_init_out_of_range", "DT2 — an alias of SINT := 300, a variable of it declared",
      "\tv : DUT_LANG_dt_alias_init_out_of_range_a;\n\tres : SINT;", "res := v;", alias("dt_alias_init_out_of_range", "a", "SINT := 300")),
    deferred: { lsp: ALIAS_INITIALIZER_UNCHECKED },
  },
  {
    ...fb("dt_alias_init_wrong_type", "DT2 — an alias of INT := 'abc', a variable of it declared",
      "\tv : DUT_LANG_dt_alias_init_wrong_type_a;\n\tres : INT;", "res := v;", alias("dt_alias_init_wrong_type", "a", "INT := 'abc'")),
    deferred: { lsp: ALIAS_INITIALIZER_UNCHECKED },
  },
  fb("dt_alias_init_narrowing", "DT2 — an alias of REAL := LREAL#1.5 and an alias of USINT := SINT#-1, variables of each declared",
    "\tv : DUT_LANG_dt_alias_init_narrowing_r;\n\tw : DUT_LANG_dt_alias_init_narrowing_u;\n\trv : REAL;\n\tuv : USINT;", "rv := v;\nuv := w;",
    alias("dt_alias_init_narrowing", "r", "REAL := LREAL#1.5") + alias("dt_alias_init_narrowing", "u", "USINT := SINT#-1")),
  // how often an alias initializer's warning is said (`dt_alias_init_narrowing` holds each twice, one variable of each in
  // an FB): with no variable of the alias, and with two
  fb("dt_alias_init_narrowing_unused", "DT2 — an alias of REAL := LREAL#1.5 that no variable is declared with", "\tn : INT;", "n := INT#1;",
    alias("dt_alias_init_narrowing_unused", "r", "REAL := LREAL#1.5")),
  fb("dt_alias_init_narrowing_two_uses", "DT2 — an alias of REAL := LREAL#1.5, two variables of it declared",
    "\tv : DUT_LANG_dt_alias_init_narrowing_two_uses_r;\n\tw : DUT_LANG_dt_alias_init_narrowing_two_uses_r;\n\trv : REAL;", "rv := v + w;",
    alias("dt_alias_init_narrowing_two_uses", "r", "REAL := LREAL#1.5")),
  {
    ...fb("dt_alias_init_narrowing_in_program", "DT2 — an alias of REAL := LREAL#1.5, one variable of it declared in PLC_PRG (a PROGRAM)", "\tn : INT;", "n := INT#1;",
      alias("dt_alias_init_narrowing_in_program", "r", "REAL := LREAL#1.5")),
    plcPrgVar: "inst_dt_alias_init_narrowing_in_program : FB_LANG_dt_alias_init_narrowing_in_program;\nv_dt_alias_init_narrowing_in_program : DUT_LANG_dt_alias_init_narrowing_in_program_r;",
  },
  // …and whether an alias's refused initializer is said with no variable of it
  fb("dt_alias_init_wrong_type_unused", "DT2 — an alias of INT := 'abc' that no variable is declared with", "\tn : INT;", "n := INT#1;",
    alias("dt_alias_init_wrong_type_unused", "a", "INT := 'abc'")),
]

// ─── DT7 — THIS and SUPER (task 4.7.4) ───────────────────────────────────────────────────────────────────────────

const BASE = (name: string): string => `FUNCTION_BLOCK FB_LANG_${name}_base\nVAR\n\tv : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n`

/** `fb` that EXTENDS `FB_LANG_<name>_base` (written ahead of it). */
function derived(name: string, feature: string, vars: string, body: string): LanguageTest {
  const t = fb(name, feature, vars, body, BASE(name))
  return { ...t, source: t.source.replace(`FUNCTION_BLOCK FB_LANG_${name}\n`, `FUNCTION_BLOCK FB_LANG_${name} EXTENDS FB_LANG_${name}_base\n`) }
}

const DT7: LanguageTest[] = [
  fb("dt_this_type", "DT7 — THIS and THIS^ assigned to STRINGs", "\ttxt1 : STRING;\n\ttxt2 : STRING;", "txt1 := THIS;\ntxt2 := THIS^;"),
  fb("dt_this_into_pointer", "DT7 — THIS stored into a POINTER TO its FB, and into a POINTER TO INT",
    "\tp : POINTER TO FB_LANG_dt_this_into_pointer;\n\tq : POINTER TO INT;", "p := THIS;\nq := THIS;"),
  derived("dt_super_type", "DT7 — SUPER and SUPER^ (an FB extending another) assigned to STRINGs", "\ttxt1 : STRING;\n\ttxt2 : STRING;",
    "txt1 := SUPER;\ntxt2 := SUPER^;"),
  derived("dt_this_deref_identity_values", "DT7 — a base member written through THIS^ and read through SUPER^ and bare",
    "\tr1 : INT;\n\tr2 : INT;", "THIS^.v := INT#9;\nr1 := SUPER^.v;\nr2 := v;"),
]

// ─── DT8 — static bases as values (task 4.7.4) ─────────────────────────────────────────────────────────────────────

/** `fb` whose body stores the name `what` into a STRING. */
function staticBase(name: string, feature: string, what: string, before = ""): LanguageTest {
  return fb(name, feature, "\ttxt : STRING;", `txt := ${what};`, before)
}

const DT8: LanguageTest[] = [
  {
    ...staticBase("dt_static_base_gvl", "DT8 — a GVL's name assigned to a STRING", "GVL_LANG_dt_static_base_gvl",
      "VAR_GLOBAL\n\tg_dt_static_base_gvl : INT;\nEND_VAR\n\n"),
    gvlNames: ["GVL_LANG_dt_static_base_gvl"],
  },
  staticBase("dt_static_base_struct_type", "DT8 — a STRUCT type's name assigned to a STRING", "DUT_LANG_dt_static_base_struct_type",
    "TYPE DUT_LANG_dt_static_base_struct_type :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  staticBase("dt_static_base_fb_type", "DT8 — a FUNCTION_BLOCK type's name assigned to a STRING", "FB_LANG_dt_static_base_fb_type_other",
    "FUNCTION_BLOCK FB_LANG_dt_static_base_fb_type_other\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
  staticBase("dt_static_base_function", "DT8 — a FUNCTION's name, uncalled, assigned to a STRING", "F_LANG_dt_static_base_function",
    "FUNCTION F_LANG_dt_static_base_function : INT\nF_LANG_dt_static_base_function := INT#1;\nEND_FUNCTION\n\n"),
  staticBase("dt_static_base_program", "DT8 — a PROGRAM's name assigned to a STRING", "PRG_LANG_dt_static_base_program",
    "PROGRAM PRG_LANG_dt_static_base_program\nVAR\n\tx : INT;\nEND_VAR\nEND_PROGRAM\n\n"),
  staticBase("dt_namespace_static_base", "DT8 — a library namespace's name (Util) assigned to a STRING", "Util"),
  staticBase("dt_interface_static_base", "DT8 — an INTERFACE's name assigned to a STRING", "I_LANG_dt_interface_static_base",
    "INTERFACE I_LANG_dt_interface_static_base\n\nMETHOD M : INT\nEND_METHOD\n\nEND_INTERFACE\n\n"),
  staticBase("dt_static_base_enum_type", "DT8 — an ENUM type's name assigned to a STRING", "DUT_LANG_dt_static_base_enum_type",
    "TYPE DUT_LANG_dt_static_base_enum_type :\n(\n\tA,\n\tB\n);\nEND_TYPE\n\n"),
  // …and the VALUES of those kinds, named as what: an FB instance and an interface variable stored into a STRING, and a
  // FUNCTION's name read inside its own body (its result)
  fb("dt_fb_instance_type_name", "DT8 — an FB instance assigned to a STRING", "\tinst : FB_LANG_dt_fb_instance_type_name_other;\n\ttxt : STRING;",
    "txt := inst;", "FUNCTION_BLOCK FB_LANG_dt_fb_instance_type_name_other\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
  fb("dt_interface_variable_type_name", "DT8 — an interface variable assigned to a STRING", "\titf : I_LANG_dt_interface_variable_type_name;\n\ttxt : STRING;",
    "txt := itf;", "INTERFACE I_LANG_dt_interface_variable_type_name\n\nMETHOD M : INT\nEND_METHOD\n\nEND_INTERFACE\n\n"),
  fb("dt_function_name_in_own_body", "DT8 — a FUNCTION's name read inside its own body, assigned to a STRING", "\tn : INT;",
    "n := F_LANG_dt_function_name_in_own_body();",
    "FUNCTION F_LANG_dt_function_name_in_own_body : INT\nVAR\n\ttxt : STRING;\nEND_VAR\nF_LANG_dt_function_name_in_own_body := INT#1;\ntxt := F_LANG_dt_function_name_in_own_body;\nEND_FUNCTION\n\n"),
  fb("dt_interface_static_member", "DT8 — a method called through an INTERFACE's name, `I.M()`", "\tn : INT;",
    "n := I_LANG_dt_interface_static_member.M();",
    "INTERFACE I_LANG_dt_interface_static_member\n\nMETHOD M : INT\nEND_METHOD\n\nEND_INTERFACE\n\n"),
  // …and the cells the 4.7.4 review found unmeasured: an interface and an FB instance stored into INTEGERS (only a STRING
  // target was asked), a STRUCT type's name called, a member none of those names declares, and another FB's uncalled
  // method read inside a method of the same name
  fb("dt_interface_into_integers", "DT8 — an interface variable assigned to an LWORD, a DWORD, an __XWORD and an INT",
    "\titf : I_LANG_dt_interface_into_integers;\n\tlw : LWORD;\n\tdw : DWORD;\n\txw : __XWORD;\n\ti : INT;",
    "lw := itf;\ndw := itf;\nxw := itf;\ni := itf;",
    "INTERFACE I_LANG_dt_interface_into_integers\n\nMETHOD M : INT\nEND_METHOD\n\nEND_INTERFACE\n\n"),
  fb("dt_fb_instance_into_integers", "DT8 — an FB instance assigned to an LWORD, a DWORD, an __XWORD and an INT",
    "\tinst : FB_LANG_dt_fb_instance_into_integers_other;\n\tlw : LWORD;\n\tdw : DWORD;\n\txw : __XWORD;\n\ti : INT;",
    "lw := inst;\ndw := inst;\nxw := inst;\ni := inst;",
    "FUNCTION_BLOCK FB_LANG_dt_fb_instance_into_integers_other\nVAR\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
  fb("dt_struct_type_name_called", "DT8 — a STRUCT type's name called, as a statement and as an INT's value", "\tn : INT;",
    "DUT_LANG_dt_struct_type_name_called();\nn := DUT_LANG_dt_struct_type_name_called();",
    "TYPE DUT_LANG_dt_struct_type_name_called :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("dt_static_base_unknown_member", "DT8 — a member that a STRUCT type's, an INTERFACE's, a PROGRAM's name and THIS^ do not declare", "\tn : INT;",
    "n := DUT_LANG_dt_static_base_unknown_member.nope;\nn := I_LANG_dt_static_base_unknown_member.nope;\n" +
      "n := PRG_LANG_dt_static_base_unknown_member.nope;\nn := THIS^.nope;",
    "TYPE DUT_LANG_dt_static_base_unknown_member :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n" +
      "INTERFACE I_LANG_dt_static_base_unknown_member\n\nMETHOD M : INT\nEND_METHOD\n\nEND_INTERFACE\n\n" +
      "PROGRAM PRG_LANG_dt_static_base_unknown_member\nVAR\n\tx : INT;\nEND_VAR\nEND_PROGRAM\n\n"),
  {
    ...fb("dt_method_name_in_same_named_method", "DT8 — another FB's uncalled method `a.Value` read inside a method named Value, and in one named Other",
      "\ta : FB_LANG_dt_method_name_in_same_named_method_other;\n\ttxt : STRING;", ""),
    source:
      "FUNCTION_BLOCK FB_LANG_dt_method_name_in_same_named_method_other\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD Value : INT\nValue := INT#1;\nEND_METHOD\n\n" +
      "FUNCTION_BLOCK FB_LANG_dt_method_name_in_same_named_method\nVAR\n\ta : FB_LANG_dt_method_name_in_same_named_method_other;\n\ttxt : STRING;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD Value : INT\ntxt := a.Value;\nEND_METHOD\n\nMETHOD Other : INT\ntxt := a.Value;\nEND_METHOD\n",
  },
]

// ─── DT9 — positional calls (task 4.7.4) ─────────────────────────────────────────────────────────────────────────

const DT9: LanguageTest[] = [
  fb("dt_program_called_positionally", "DT9 — a PROGRAM with one input called positionally, `P(5)`", "\tn : INT;",
    "PRG_LANG_dt_program_called_positionally(5);\nn := PRG_LANG_dt_program_called_positionally.seen;",
    "PROGRAM PRG_LANG_dt_program_called_positionally\nVAR_INPUT\n\tk : INT;\nEND_VAR\nVAR_OUTPUT\n\tseen : INT;\nEND_VAR\nseen := k;\nEND_PROGRAM\n\n"),
  fb("dt_interface_method_positional_values", "DT9 — an interface's method called positionally through an interface variable, `itf.Twice(21)`",
    "\timpl : FB_LANG_dt_interface_method_positional_values_impl;\n\titf : I_LANG_dt_interface_method_positional_values;\n\tn : INT;",
    "itf := impl;\nn := itf.Twice(INT#21);",
    "INTERFACE I_LANG_dt_interface_method_positional_values\n\nMETHOD Twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nEND_METHOD\n\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_dt_interface_method_positional_values_impl IMPLEMENTS I_LANG_dt_interface_method_positional_values\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD Twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nTwice := k * INT#2;\nEND_METHOD\n\n"),
]

// ─── DT10/DT11 — rendering (task 4.7.4) ────────────────────────────────────────────────────────────────────────────

/** `fb` that assigns a variable of each of `decls` (its type) into an INT of its own. */
function rendered(name: string, feature: string, decls: readonly string[]): LanguageTest {
  const vars = decls.map((d, i) => `\tv${i + 1} : ${d};\n\ti${i + 1} : INT;`).join("\n")
  const body = decls.map((_, i) => `i${i + 1} := v${i + 1};`).join("\n")
  return fb(name, feature, vars, body)
}

const DT10: LanguageTest[] = [
  rendered("dt_render_array_dims", "DT10 — an ARRAY of two dimensions, an ARRAY OF STRING(5) and an ARRAY OF ARRAY, each into an INT",
    ["ARRAY[1..2, 0..1] OF BYTE", "ARRAY[0..1] OF STRING(5)", "ARRAY[0..1] OF ARRAY[0..2] OF INT"]),
  rendered("dt_render_string_capacity", "DT10 — a STRING(5), a sizeless STRING, a WSTRING(7) and a sizeless WSTRING, each into an INT",
    ["STRING(5)", "STRING", "WSTRING(7)", "WSTRING"]),
  rendered("dt_render_date_time_names", "DT10 — a DATE, a TIME_OF_DAY, a DATE_AND_TIME, a TIME and an LTIME, each into an INT",
    ["DATE", "TOD", "DT", "TIME", "LTIME"]),
  rendered("dt_render_pointer_names", "DT10 — a POINTER TO POINTER TO INT, a POINTER TO STRING(5) and a POINTER TO an ARRAY OF REAL, each into an INT",
    ["POINTER TO POINTER TO INT", "POINTER TO STRING(5)", "POINTER TO ARRAY[0..1] OF REAL"]),
]

const DT11: LanguageTest[] = [
  fb("dt_render_string_literal", "DT11 — an empty string literal, one with a `$$` escape and a WSTRING literal, each into an INT",
    "\ti1 : INT;\n\ti2 : INT;\n\ti3 : INT;", "i1 := '';\ni2 := 'a$$b';\ni3 := \"wide\";"),
  {
    ...fb("dt_render_string_constant", "DT11 — a STRING CONSTANT holding 'abc' into an INT", "\ti : INT;", "i := c;"),
    source: "FUNCTION_BLOCK FB_LANG_dt_render_string_constant\nVAR CONSTANT\n\tc : STRING := 'abc';\nEND_VAR\nVAR\n\ti : INT;\nEND_VAR\ni := c;\nEND_FUNCTION_BLOCK\n",
  },
]

export const DERIVED_TYPE_TESTS: readonly LanguageTest[] = [...DT1, ...DT2, ...DT3, ...DT4, ...DT6, ...DT7, ...DT8, ...DT9, ...DT10, ...DT11]
