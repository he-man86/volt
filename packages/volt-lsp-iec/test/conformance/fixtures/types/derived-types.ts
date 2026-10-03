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

export const DERIVED_TYPE_TESTS: readonly LanguageTest[] = [...DT3, ...DT4, ...DT6]
