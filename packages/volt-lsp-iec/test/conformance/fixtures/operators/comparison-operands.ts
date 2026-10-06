/**
 * COMPARISON OPERANDS THE COMPILER REFUSES — openspec `analysis-conformance` task 3.1.1 (types A), the `comparison`
 * check rule by rule (`src/analysis/checks/types/comparison.ts`):
 *
 *   C0068 compareNotPossible     an ARRAY operand: two arrays of one type, an array against a scalar (either side), every
 *                                relational operator, a two-dimensional array, an array of a struct
 *   C0069 compareNotPossibleTwo  two arrays of different types: other bounds, other element type
 *   C0066 cannotCompare          the pairs the check left UNMEASURED: a pointer against a SIGNED integer, a string
 *                                against a wide string, a TIME against an INT, a BOOL against an INT
 *   C0354 enumComparison         an enum VARIABLE against another enum's VALUE (unmeasured: the check is silent there)
 *   (silent by the check)        a struct against a struct, a function block instance against another, two interfaces
 *
 * The census (0.3) measured `compareNotPossible` and `compareNotPossibleTwo` at 0 TP on both vendors: no fixture had
 * ever compared an array. Every result is stored into a BOOL, so the comparison's own message is the only one asked.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.1.1 (comparison); docs/codesys-reference/05-operators.md"

/** A function block `FB_LANG_<name>` with VAR `decls` + `out : BOOL`, assigning `expr` to `out`; `before` is written ahead. */
function probe(name: string, feature: string, decls: string, expr: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${decls}\n\tout : BOOL;\nEND_VAR\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

const ARRAYS = "\ta1 : ARRAY[1..2] OF INT;\n\ta2 : ARRAY[1..2] OF INT;\n\ta3 : ARRAY[1..3] OF INT;\n\tad : ARRAY[1..2] OF DINT;\n\ti : INT;"
const structOf = (name: string): string => `TYPE DUT_LANG_${name} :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n`

const ARRAY_OPERANDS: LanguageTest[] = [
  probe("cmpop_array_same_type", "two ARRAY[1..2] OF INT compared with =", ARRAYS, "a1 = a2"),
  probe("cmpop_array_same_type_ordered", "two ARRAY[1..2] OF INT compared with <", ARRAYS, "a1 < a2"),
  probe("cmpop_array_same_type_not_equal", "two ARRAY[1..2] OF INT compared with <>", ARRAYS, "a1 <> a2"),
  probe("cmpop_array_with_itself", "one ARRAY[1..2] OF INT compared with itself (=)", ARRAYS, "a1 = a1"),
  probe("cmpop_array_other_bounds", "ARRAY[1..2] OF INT compared with ARRAY[1..3] OF INT", ARRAYS, "a1 = a3"),
  probe("cmpop_array_other_element", "ARRAY[1..2] OF INT compared with ARRAY[1..2] OF DINT", ARRAYS, "a1 >= ad"),
  probe("cmpop_array_vs_scalar", "an ARRAY[1..2] OF INT compared with an INT, the array on the left", ARRAYS, "a1 = i"),
  probe("cmpop_scalar_vs_array", "an INT compared with an ARRAY[1..2] OF INT, the array on the right", ARRAYS, "i > a1"),
  probe("cmpop_array_two_dims", "two ARRAY[1..2, 0..1] OF BYTE compared with =",
    "\tm1 : ARRAY[1..2, 0..1] OF BYTE;\n\tm2 : ARRAY[1..2, 0..1] OF BYTE;", "m1 = m2"),
  probe("cmpop_array_of_struct", "two ARRAY[0..1] OF a struct compared with =",
    "\tsa : ARRAY[0..1] OF DUT_LANG_cmpop_array_of_struct;\n\tsb : ARRAY[0..1] OF DUT_LANG_cmpop_array_of_struct;", "sa = sb",
    structOf("cmpop_array_of_struct")),
  {
    ...probe("cmpop_array_constant_bound", "two ARRAY[0..N] OF INT, N a VAR CONSTANT, compared with =", "", "sb = sc"),
    source: "FUNCTION_BLOCK FB_LANG_cmpop_array_constant_bound\nVAR CONSTANT\n\tN : INT := 2;\nEND_VAR\nVAR\n" +
      "\tsb : ARRAY[0..N] OF INT;\n\tsc : ARRAY[0..N] OF INT;\n\tout : BOOL;\nEND_VAR\nout := sb = sc;\nEND_FUNCTION_BLOCK\n",
  },
  // 3.1+3.3 gate review: one type written with two bound spellings, and a bound written as an operation
  {
    ...probe("cmpop_array_bound_spellings", "ARRAY[1..2] OF INT compared with ARRAY[1..N] OF INT, N a VAR CONSTANT 2", "", "a1 = a2"),
    source: "FUNCTION_BLOCK FB_LANG_cmpop_array_bound_spellings\nVAR CONSTANT\n\tN : INT := 2;\nEND_VAR\nVAR\n" +
      "\ta1 : ARRAY[1..2] OF INT;\n\ta2 : ARRAY[1..N] OF INT;\n\tout : BOOL;\nEND_VAR\nout := a1 = a2;\nEND_FUNCTION_BLOCK\n",
  },
  {
    ...probe("cmpop_array_bound_expression", "two ARRAY[0..N-1] OF INT, N a VAR CONSTANT, compared with =", "", "a1 = a2"),
    source: "FUNCTION_BLOCK FB_LANG_cmpop_array_bound_expression\nVAR CONSTANT\n\tN : INT := 3;\nEND_VAR\nVAR\n" +
      "\ta1 : ARRAY[0..N-1] OF INT;\n\ta2 : ARRAY[0..N-1] OF INT;\n\tout : BOOL;\nEND_VAR\nout := a1 = a2;\nEND_FUNCTION_BLOCK\n",
  },
]

const SCALAR_PAIRS: LanguageTest[] = [
  probe("cmpop_pointer_vs_dint", "a POINTER TO INT compared with a DINT", "\tx : INT;\n\tp : POINTER TO INT;\n\td : DINT;", "p = d"),
  probe("cmpop_pointer_vs_lint", "a POINTER TO INT compared with a LINT", "\tx : INT;\n\tp : POINTER TO INT;\n\tl : LINT;", "p = l"),
  probe("cmpop_pointer_vs_sint", "a POINTER TO INT compared with a SINT", "\tx : INT;\n\tp : POINTER TO INT;\n\tn : SINT;", "p <> n"),
  // …and the unsigned widths `cb_compare_pointers` did not ask (it asked LWORD, ULINT and DWORD)
  probe("cmpop_pointer_vs_byte", "a POINTER TO INT compared with a BYTE", "\tx : INT;\n\tp : POINTER TO INT;\n\tn : BYTE;", "p = n"),
  probe("cmpop_pointer_vs_uint", "a POINTER TO INT compared with a UINT", "\tx : INT;\n\tp : POINTER TO INT;\n\tn : UINT;", "p = n"),
  probe("cmpop_pointer_vs_udint", "a POINTER TO INT compared with a UDINT", "\tx : INT;\n\tp : POINTER TO INT;\n\tn : UDINT;", "p = n"),
  probe("cmpop_pointer_vs_int_ordered", "an INT compared with a POINTER TO INT (<), the pointer on the right",
    "\tx : INT;\n\tp : POINTER TO INT;\n\ti : INT;", "i < p"),
  probe("cmpop_pointer_vs_xint", "a POINTER TO INT compared with an __XINT", "\tx : INT;\n\tp : POINTER TO INT;\n\txi : __XINT;", "p = xi"),
  probe("cmpop_string_vs_wstring", "a STRING compared with a WSTRING", "\tsv : STRING;\n\twv : WSTRING;", "sv = wv"),
  probe("cmpop_time_vs_int", "a TIME compared with an INT", "\tt : TIME;\n\ti : INT;", "t > i"),
  probe("cmpop_bool_vs_int", "a BOOL compared with an INT", "\tb : BOOL;\n\ti : INT;", "b = i"),
  probe("cmpop_date_vs_time", "a DATE compared with a TIME", "\td : DATE;\n\tt : TIME;", "d < t"),
  probe("cmpop_real_vs_string", "a REAL compared with a STRING", "\trv : REAL;\n\tsv : STRING;", "rv = sv"),
]

const enumPair = (name: string): string =>
  `TYPE DUT_LANG_${name}_a :\n(\n\tA0 := 0,\n\tA1 := 1\n);\nEND_TYPE\n\nTYPE DUT_LANG_${name}_b :\n(\n\tB0 := 0,\n\tB1 := 1\n);\nEND_TYPE\n\n`

const COMPOSITE_OPERANDS: LanguageTest[] = [
  probe("cmpop_enum_var_vs_other_value", "an enum variable compared with another enum type's value",
    "\tea : DUT_LANG_cmpop_enum_var_vs_other_value_a;", "ea = DUT_LANG_cmpop_enum_var_vs_other_value_b.B1",
    enumPair("cmpop_enum_var_vs_other_value")),
  probe("cmpop_struct_vs_struct", "two variables of one struct type compared with =",
    "\ts1 : DUT_LANG_cmpop_struct_vs_struct;\n\ts2 : DUT_LANG_cmpop_struct_vs_struct;", "s1 = s2", structOf("cmpop_struct_vs_struct")),
  probe("cmpop_struct_vs_int", "a struct variable compared with an INT",
    "\ts1 : DUT_LANG_cmpop_struct_vs_int;\n\ti : INT;", "s1 = i", structOf("cmpop_struct_vs_int")),
  probe("cmpop_fb_vs_fb", "two instances of one function block compared with =",
    "\tt1 : TON;\n\tt2 : TON;", "t1 = t2"),
]

export const COMPARISON_OPERAND_TESTS: readonly LanguageTest[] = [...ARRAY_OPERANDS, ...SCALAR_PAIRS, ...COMPOSITE_OPERANDS]
