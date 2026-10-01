/**
 * THE DECLARATIONS, RULE BY RULE — design.md §4 2.3 of openspec `frontend-conformance` (D1–D19, U23), each rule put to
 * the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec` for the
 * VALUE a declaration gives its variable (every fixture below that builds copies what it declares into `out`, a
 * variable of the FB, so the run recording holds `inst_<name>.out`). Rows already decided by a recorded fixture
 * elsewhere keep those fixtures; what is here is what no recording decided before task 2.3.
 *
 * ONE QUESTION PER FIXTURE, as in `lexer.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.3 (declarations)"

/** A function block `FB_LANG_<name>` with `sections` (whole VAR sections) as its declaration and `body` as its code. */
function fb(name: string, feature: string, sections: string, body: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\n${sections}\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** `fb`, instanced in PLC_PRG as `FB_LANG_<name><arg>` — a VAR_GENERIC FB's instance names its generic value. */
function generic(name: string, feature: string, sections: string, body: string, arg: string): LanguageTest {
  const t = fb(name, feature, sections, body)
  return { ...t, plcPrgVar: `inst_${name} : ${t.pouName}${arg};` }
}

/** One `VAR … END_VAR` section holding `decl` beside `out : INT`, and `body`. */
function inVar(name: string, feature: string, decl: string, body: string): LanguageTest {
  return fb(name, feature, `VAR\n${decl}\n\tout : INT;\nEND_VAR`, body)
}

/** A section headed `header` (keyword and qualifiers) holding `decl`, with `out : INT` in a plain VAR beside it. */
function inSection(name: string, feature: string, header: string, decl: string, body: string): LanguageTest {
  return fb(name, feature, `${header}\n${decl}\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR`, body)
}

/** A GVL `GVL_LANG_<name>` whose text is `source`; PLC_PRG reads `read` (a qualified global) when it is given. */
function gvl(name: string, feature: string, source: string, read?: string): LanguageTest {
  return {
    name,
    pouName: `GVL_LANG_${name}`,
    kind: "gvl",
    feature,
    fromDoc: doc,
    source,
    plcPrgVar: `seen_${name} : INT;`,
    ...(read !== undefined ? { plcPrgBody: `seen_${name} := ${read};` } : {}),
  }
}

/** A STRUCT `DUT_LANG_<name>` with `fields`, and an FB holding one of it (`rec` — `s` and `st` are the IL operators S and ST, reserved words — initialized by `init` when given) whose body is `body`. */
function struct(name: string, feature: string, fields: string, body: string, init?: string): LanguageTest {
  const dut = `DUT_LANG_${name}`
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `TYPE ${dut} :\nSTRUCT\n${fields}\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK ${pouName}\nVAR\n\trec : ${dut}${init !== undefined ? ` := ${init}` : ""};\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** `struct`, with the types written whole (`types`, declaring `DUT_LANG_<name>`) — a UNION, or a struct of a struct. */
function typed(name: string, feature: string, types: string, body: string, init: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${types}\nFUNCTION_BLOCK ${pouName}\nVAR\n\trec : DUT_LANG_${name} := ${init};\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** `fb` with `types` (whole TYPE declarations) written before it — an FB whose declarations use a DUT of their own. */
function withTypes(name: string, feature: string, types: string, sections: string, body: string): LanguageTest {
  const t = fb(name, feature, sections, body)
  return { ...t, source: `${types}\n${t.source}` }
}

/** `fb`, instanced in PLC_PRG as an ARRAY of `FB_LANG_<name><arg>` — a VAR_GENERIC FB as an array's element type. */
function genericArray(name: string, feature: string, sections: string, body: string, arg: string): LanguageTest {
  const t = fb(name, feature, sections, body)
  return { ...t, plcPrgVar: `inst_${name} : ARRAY[0..1] OF ${t.pouName}${arg};`, plcPrgBody: `inst_${name}[0]();` }
}

export const DECLARATION_RULE_TESTS: readonly LanguageTest[] = [
  // ─── D4 VAR_ACCESS (task 2.3.1) ─────────────────────────────────────────────────────────────────────────────────────
  // IEC's access path `name : path : type READ_ONLY|READ_WRITE`, at file scope (a GVL's text) and inside a POU.
  gvl("decl_var_access", "D4 — a VAR_ACCESS list at file scope: `accW : PLC_PRG.x : INT READ_WRITE;`",
    "VAR_ACCESS\n\taccW : PLC_PRG.seen_decl_var_access : INT READ_WRITE;\nEND_VAR\n"),
  gvl("decl_var_access_read_only", "D4 — a READ_ONLY access path at file scope",
    "VAR_ACCESS\n\taccR : PLC_PRG.seen_decl_var_access_read_only : INT READ_ONLY;\nEND_VAR\n"),
  fb("decl_var_access_in_fb", "D4 — a VAR_ACCESS section inside a function block",
    "VAR\n\tout : INT;\nEND_VAR\nVAR_ACCESS\n\taccF : out : INT READ_ONLY;\nEND_VAR", "out := 1;"),
  // …and what the path and the access name ARE to the compiler: a path to nothing, no direction, the name read
  gvl("decl_var_access_unknown_path", "D4 — an access path naming a variable that does not exist",
    "VAR_ACCESS\n\taccU : PLC_PRG.no_such_variable : INT READ_WRITE;\nEND_VAR\n"),
  gvl("decl_var_access_no_direction", "D4 — an access path with neither READ_ONLY nor READ_WRITE",
    "VAR_ACCESS\n\taccN : PLC_PRG.seen_decl_var_access_no_direction : INT;\nEND_VAR\n"),
  gvl("decl_var_access_used", "D4 — an access name read through its list: `GVL.accD`",
    "VAR_ACCESS\n\taccD : PLC_PRG.seen_decl_var_access_used : INT READ_ONLY;\nEND_VAR\n", "GVL_LANG_decl_var_access_used.accD"),

  // ─── D5 VAR_GENERIC (task 2.3.1) ────────────────────────────────────────────────────────────────────────────────────
  // The instance names the generic's value in angle brackets (`FB_X<6>`); one without it is refused (`_no_argument`).
  generic("decl_var_generic", "D5 — `VAR_GENERIC CONSTANT N : UDINT := 4;` sizing an array, the FB instanced as `<6>`",
    "VAR_GENERIC CONSTANT\n\tN : UDINT := 4;\nEND_VAR\nVAR\n\ta : ARRAY[0..N] OF INT;\n\tout : INT;\n\tsize : UDINT;\nEND_VAR",
    "a[N] := 7;\nout := a[N];\nsize := N;", "<6>"),
  generic("decl_var_generic_no_argument", "D5 — a VAR_GENERIC FB instanced WITHOUT its generic argument",
    "VAR_GENERIC CONSTANT\n\tN : UDINT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := 1;", ""),
  generic("decl_var_generic_no_constant", "D5 — a VAR_GENERIC section without CONSTANT",
    "VAR_GENERIC\n\tN : UDINT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := 1;", "<6>"),
  // A wrong count that is not zero: the count message was measured with NO value only (`_no_argument`)
  generic("decl_var_generic_two_values", "D5 — a one-constant VAR_GENERIC FB instanced with two values: `<6, 7>`",
    "VAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := N;", "<6, 7>"),
  generic("decl_var_generic_read", "D5 — a VAR_GENERIC CONSTANT read in the body",
    "VAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := N;", "<6>"),
  // …as an ARRAY's element type: is the count asked there too (2.3a)
  genericArray("decl_var_generic_in_array", "D5 — an ARRAY OF a VAR_GENERIC FB with its value: `ARRAY[0..1] OF FB<6>`",
    "VAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := N;", "<6>"),
  genericArray("decl_var_generic_in_array_no_argument", "D5 — an ARRAY OF a VAR_GENERIC FB without its value",
    "VAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := N;", ""),
  genericArray("decl_var_generic_in_array_two_values", "D5 — an ARRAY OF a one-constant VAR_GENERIC FB with two values: `<6, 7>`",
    "VAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := N;", "<6, 7>"),

  // ─── D6/D7 section qualifiers (task 2.3.2) ──────────────────────────────────────────────────────────────────────────
  gvl("decl_non_retain_in_gvl", "D7 — `VAR_GLOBAL NON_RETAIN`",
    "VAR_GLOBAL NON_RETAIN\n\tgNr : INT := 3;\nEND_VAR\n", "GVL_LANG_decl_non_retain_in_gvl.gNr"),
  inSection("decl_non_retain_in_var_input", "D7 — `VAR_INPUT NON_RETAIN`", "VAR_INPUT NON_RETAIN", "\tnr : INT := 3;", "out := nr;"),
  inVar("decl_non_retain_as_name", "D7 — NON_RETAIN as a variable NAME: is it a word or a keyword?",
    "\tNON_RETAIN : INT;", "NON_RETAIN := 4;\nout := NON_RETAIN;"),
  inSection("decl_constant_retain", "D6 — `VAR CONSTANT RETAIN`", "VAR CONSTANT RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_retain_constant", "D6 — `VAR RETAIN CONSTANT`, the other order", "VAR RETAIN CONSTANT", "\tk : INT := 3;", "out := k;"),
  inSection("decl_persistent_retain", "D6 — `VAR PERSISTENT RETAIN`, the other order of RETAIN PERSISTENT", "VAR PERSISTENT RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_retain_twice", "D6 — a qualifier twice: `VAR RETAIN RETAIN`", "VAR RETAIN RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_retain_non_retain", "D6/D7 — `VAR RETAIN NON_RETAIN`", "VAR RETAIN NON_RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_input_retain", "D6 — `VAR_INPUT RETAIN`", "VAR_INPUT RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_output_constant", "D6 — `VAR_OUTPUT CONSTANT`", "VAR_OUTPUT CONSTANT", "\tk : INT := 3;", "out := k;"),
  inSection("decl_temp_retain", "D6 — `VAR_TEMP RETAIN`", "VAR_TEMP RETAIN", "\tk : INT := 3;", "out := k;"),
  inSection("decl_temp_constant", "D6 — `VAR_TEMP CONSTANT`", "VAR_TEMP CONSTANT", "\tk : INT := 3;", "out := k;"),

  // ─── D8 several names (task 2.3.3) ──────────────────────────────────────────────────────────────────────────────────
  inVar("decl_names_trailing_comma", "D8 — a name list ending in a comma: `a, : INT;`", "\ta, : INT;", "out := 1;"),
  inVar("decl_names_with_at", "D8/D9 — `AT` after a name LIST: `a, b AT %MW40 : INT;`", "\ta, b AT %MW40 : INT;", "a := 5;\nout := a;"),

  // ─── D9/D10 AT before and after the type (task 2.3.3) ──────────────────────────────────────────────────────────────
  inVar("decl_at_after_type", "D10 — `AT` after the type: `v : INT AT %MW42;`", "\tv : INT AT %MW42;", "v := 5;\nout := v;"),
  inVar("decl_at_after_type_with_init", "D10 — `AT` after the type, then an initializer: `v : INT AT %MW44 := 6;`",
    "\tv : INT AT %MW44 := 6;", "out := v;"),
  inVar("decl_at_twice", "D9/D10 — `AT` on both sides of the type", "\tv AT %MW46 : INT AT %MW48;", "v := 5;\nout := v;"),
  gvl("decl_at_after_type_in_gvl", "D10 — `AT` after the type in a GVL: `gAt : INT AT %MW50;`",
    "VAR_GLOBAL\n\tgAt : INT AT %MW50;\nEND_VAR\n", "GVL_LANG_decl_at_after_type_in_gvl.gAt"),
  inVar("decl_at_empty", "D9 — `AT` with no operand: `v AT : INT;`", "\tv AT : INT;", "v := 5;\nout := v;"),

  // ─── D11 an AT operand that is no address (task 2.3.3) ──────────────────────────────────────────────────────────────
  // (an IDENTIFIER operand is `cc5_at_address_not_direct`'s; these are the other operand kinds)
  inVar("decl_at_not_an_address", "D11 — an integer as the AT operand: `v AT 16#10 : INT;`", "\tv AT 16#10 : INT;", "v := 5;\nout := v;"),
  inVar("decl_at_not_an_address_after_type", "D10/D11 — an identifier as the AT operand after the type: `v : INT AT abc;`",
    "\tv : INT AT abc;", "v := 5;\nout := v;"),
  inVar("decl_at_not_an_address_string", "D11 — a string as the AT operand: `v AT 'x' : INT;`", "\tv AT 'x' : INT;", "v := 5;\nout := v;"),
  {
    name: "decl_at_incomplete_in_program",
    pouName: "PRG_LANG_decl_at_incomplete_in_program",
    kind: "program",
    feature: "D9/A2 — an incomplete address `AT %I*` in a PROGRAM's own declarations (PLC_PRG), not a function block's",
    fromDoc: doc,
    source: "",
    plcPrgVar: "inc AT %I* : BOOL;\n\tincOut : BOOL;",
    plcPrgBody: "incOut := inc;",
    execSkip:
      "NOTHING TO MEASURE — recorded as \"Login failed...\" (CODESYS 2026-10-01), as `lit_address_incomplete` is: an incomplete address is completed by a VAR_CONFIG, which the recording project does not have, so the application builds and never starts; its one question is what the build says",
  },

  // ─── D12 scalar and REF= initializers (task 2.3.4) ──────────────────────────────────────────────────────────────────
  inVar("decl_ref_init_on_value", "D12 — `REF=` on a declaration that is no REFERENCE: `v : INT REF= w;`",
    "\tw : INT := 3;\n\tv : INT REF= w;", "out := v;"),
  inVar("decl_init_empty", "D12 — `:=` with nothing after it: `v : INT := ;`", "\tv : INT := ;", "out := v;"),

  // ─── D15 repeat counts and nested aggregates (task 2.3.4) ───────────────────────────────────────────────────────────
  fb("decl_repeat_count", "D15 — a repeat count filling the array: `[5(7)]`",
    "VAR\n\ta : ARRAY[0..4] OF INT := [5(7)];\n\tout : INT;\nEND_VAR", "out := a[4];"),
  fb("decl_repeat_count_mixed", "D15 — a repeat count between values: `[1, 3(2), 9]`",
    "VAR\n\ta : ARRAY[0..4] OF INT := [1, 3(2), 9];\n\tout : INT;\nEND_VAR", "out := a[4];"),
  fb("decl_repeat_count_short", "D15 — a repeat count filling part of the array: `[2(7)]`",
    "VAR\n\ta : ARRAY[0..4] OF INT := [2(7)];\n\tout : INT;\nEND_VAR", "out := a[2];"),
  fb("decl_repeat_count_too_many", "D15 — a repeat count larger than the array: `[6(7)]` for five elements",
    "VAR\n\ta : ARRAY[0..4] OF INT := [6(7)];\n\tout : INT;\nEND_VAR", "out := a[4];"),
  fb("decl_repeat_count_empty", "D15 — a repeat count with no value: `[3()]`",
    "VAR\n\ta : ARRAY[0..4] OF INT := [3()];\n\tout : INT;\nEND_VAR", "out := a[0];"),
  // (typed literals, so the count has a type of its own; an untyped literal's typing is area 4's)
  fb("decl_repeat_count_expression", "D15 — a repeat count that is an expression: `[INT#2+INT#3(7)]`",
    "VAR\n\ta : ARRAY[0..4] OF INT := [INT#2+INT#3(7)];\n\tout : INT;\nEND_VAR", "out := a[4];"),
  // …and the same shape ending in a NAME: is `L(7)` the repeat or L's call?
  fb("decl_repeat_count_expression_names", "D15 — an expression of names before a group: `[K+L(7)]`, K = 2 and L = 3",
    "VAR CONSTANT\n\tK : INT := 2;\n\tL : INT := 3;\nEND_VAR\nVAR\n\ta : ARRAY[0..4] OF INT := [K+L(7)];\n\tout : INT;\nEND_VAR", "out := a[4];"),
  fb("decl_nested_aggregate", "D15 — a two-dimensional array written as nested lists: `[[1, 2], [3, 4]]`",
    "VAR\n\ta : ARRAY[0..1, 0..1] OF INT := [[1, 2], [3, 4]];\n\tout : INT;\nEND_VAR", "out := a[1, 0];"),
  fb("decl_nested_aggregate_flat", "D15 — a two-dimensional array written flat: `[1, 2, 3, 4]`",
    "VAR\n\ta : ARRAY[0..1, 0..1] OF INT := [1, 2, 3, 4];\n\tout : INT;\nEND_VAR", "out := a[1, 0];"),
  fb("decl_nested_aggregate_array_of_array", "D15 — an ARRAY OF ARRAY written as nested lists",
    "VAR\n\ta : ARRAY[0..1] OF ARRAY[0..1] OF INT := [[1, 2], [3, 4]];\n\tout : INT;\nEND_VAR", "out := a[1][0];"),
  fb("decl_nested_aggregate_repeat", "D15 — a repeat count of a nested list: `[2([1, 2])]`",
    "VAR\n\ta : ARRAY[0..1] OF ARRAY[0..1] OF INT := [2([1, 2])];\n\tout : INT;\nEND_VAR", "out := a[1][1];"),

  // ─── D16 a bracket initializer without `:=` (task 2.3.4) ────────────────────────────────────────────────────────────
  fb("decl_bracket_init_no_assign", "D16 — an array list with no `:=`: `a : ARRAY[0..1] OF INT [1, 2];`",
    "VAR\n\ta : ARRAY[0..1] OF INT [1, 2];\n\tout : INT;\nEND_VAR", "out := a[1];"),
  inVar("decl_bracket_init_no_assign_scalar", "D16 — a bracket list with no `:=` on a SCALAR: `v : INT [1];`",
    "\tv : INT [1];", "out := v;"),
  // …and the form the rule is FOR: an array of function blocks, each element a parenthesized input list
  {
    name: "decl_bracket_init_no_assign_fb",
    pouName: "FB_LANG_decl_bracket_init_no_assign_fb",
    kind: "function_block",
    feature: "D16 — an ARRAY OF a function block initialized with no `:=`: `fbs : ARRAY[0..1] OF FB [(x := 1), (x := 2)];`",
    fromDoc: doc,
    plcPrgVar: "inst_decl_bracket_init_no_assign_fb : FB_LANG_decl_bracket_init_no_assign_fb;",
    plcPrgBody: "inst_decl_bracket_init_no_assign_fb();",
    source:
      "FUNCTION_BLOCK FB_LANG_decl_bracket_init_elem\nVAR_INPUT\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_decl_bracket_init_no_assign_fb\nVAR\n\tfbs : ARRAY[0..1] OF FB_LANG_decl_bracket_init_elem [(x := 1), (x := 2)];\n\tout : INT;\nEND_VAR\nout := fbs[1].x;\nEND_FUNCTION_BLOCK\n",
  },

  // ─── D14 a struct initializer's fields (task 2.3.4) ─────────────────────────────────────────────────────────────────
  struct("decl_struct_init_missing_field", "D14 — a struct initializer naming one field of two: the other keeps its type's value",
    "\ta : INT;\n\tb : INT := 9;", "out := rec.b;", "(a := 1)"),
  struct("decl_struct_init_positional", "D14 — a struct initializer with no field names: `(1, 2)`",
    "\ta : INT;\n\tb : INT;", "out := rec.b;", "(1, 2)"),
  struct("decl_struct_init_positional_five", "D14 — a struct initializer with no field names, first value 5: `(5, 2)`",
    "\ta : INT;\n\tb : INT;", "out := rec.b;", "(5, 2)"),
  inVar("decl_array_init_positional", "D14 — a parenthesized value list on an ARRAY, not a STRUCT: `(1, 2)`",
    "\ta : ARRAY[0..1] OF INT := (1, 2);", "out := a[1];"),
  typed("decl_struct_init_nested_unknown_field", "D14 — a NESTED struct initializer naming a field the inner struct lacks",
    "TYPE DUT_LANG_decl_struct_init_nested_unknown_field_inner :\nSTRUCT\n\tq : INT;\nEND_STRUCT\nEND_TYPE\n\nTYPE DUT_LANG_decl_struct_init_nested_unknown_field :\nSTRUCT\n\tinn : DUT_LANG_decl_struct_init_nested_unknown_field_inner;\nEND_STRUCT\nEND_TYPE\n",
    "out := rec.inn.q;", "(inn := (zz := 1))"),
  typed("decl_union_init_unknown_field", "D14 — a UNION initializer naming a member the union lacks: `(zz := 1)`",
    "TYPE DUT_LANG_decl_union_init_unknown_field :\nUNION\n\ta : INT;\n\tb : DINT;\nEND_UNION\nEND_TYPE\n",
    "out := rec.a;", "(zz := 1)"),
  struct("decl_struct_init_unknown_field", "D14 — a struct initializer naming a field the struct lacks: `(c := 1)`",
    "\ta : INT;\n\tb : INT;", "out := rec.a;", "(c := 1)"),
  // …and inside an ARRAY's initializer: an element's struct value, at the top and as a field's array value (2.3a)
  withTypes("decl_struct_init_unknown_field_in_array", "D14 — an ARRAY OF a struct initialized `[(c := 1)]`: a field the struct lacks",
    "TYPE DUT_LANG_decl_struct_init_unknown_field_in_array :\nSTRUCT\n\tp1 : INT;\n\tp2 : INT;\nEND_STRUCT\nEND_TYPE\n",
    "VAR\n\trec : ARRAY[0..1] OF DUT_LANG_decl_struct_init_unknown_field_in_array := [(c := 1)];\n\tout : INT;\nEND_VAR",
    "out := rec[0].p1;"),
  typed("decl_struct_init_unknown_field_in_field_array", "D14 — a struct field's ARRAY value `[(zz := 1)]` naming a field its element lacks",
    "TYPE DUT_LANG_decl_struct_init_unknown_field_in_field_array_inner :\nSTRUCT\n\tq : INT;\nEND_STRUCT\nEND_TYPE\n\nTYPE DUT_LANG_decl_struct_init_unknown_field_in_field_array :\nSTRUCT\n\tarr : ARRAY[0..1] OF DUT_LANG_decl_struct_init_unknown_field_in_field_array_inner;\nEND_STRUCT\nEND_TYPE\n",
    "out := rec.arr[0].q;", "(arr := [(zz := 1)])"),

  // ─── D19 a STRUCT field is a declaration (task 2.3.5) ───────────────────────────────────────────────────────────────
  struct("decl_struct_field_soft_name", "D19 — a STRUCT field named with a soft keyword: `GET : INT;`",
    "\tGET : INT := 4;", "out := rec.GET;"),
  struct("decl_struct_field_reserved_name", "D19 — a STRUCT field named with a reserved word: `LIMIT : INT;`",
    "\tLIMIT : INT;\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_struct_field_ref_init", "D19 — a STRUCT field bound with `REF=`: `rf : REFERENCE TO INT REF= a;`",
    "\ta : INT := 4;\n\trf : REFERENCE TO INT REF= a;", "out := rec.a;"),
  struct("decl_struct_field_at", "D19 — a STRUCT field with an AT address: `a AT %MW50 : INT;`",
    "\ta AT %MW50 : INT;\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_struct_field_at_after_type", "D19/D10 — a STRUCT field with AT after the type: `a : INT AT %MW52;`",
    "\ta : INT AT %MW52;\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_struct_field_stray_token", "D19/D13 — a stray token after a STRUCT field's initializer: `a : INT := 5 abc;`",
    "\ta : INT := 5 abc;\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_struct_field_bracket_init", "D19/D16 — a STRUCT field with a bracket list and no `:=`",
    "\ta : ARRAY[0..1] OF INT [1, 2];\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_struct_field_names", "D19/D8 — several STRUCT fields in one declaration: `a, b : INT := 4;`",
    "\ta, b : INT := 4;", "out := rec.b;"),

  // ─── U23 a VAR section inside a STRUCT (task 2.3.5) ─────────────────────────────────────────────────────────────────
  struct("decl_var_inside_struct", "U23 — a VAR section inside a STRUCT", "\tVAR\n\t\ta : INT;\n\tEND_VAR\n\tb : INT := 4;", "out := rec.b;"),
  // …and how the compiler ECHOES the section it refuses: an initializer, a name list, another section keyword
  struct("decl_var_inside_struct_init", "U23 — a VAR section with an initialized declaration inside a STRUCT",
    "\tVAR\n\t\ta : INT := 5;\n\tEND_VAR\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_var_inside_struct_names", "U23 — a VAR section with a name list inside a STRUCT",
    "\tVAR\n\t\ta, c : BOOL;\n\tEND_VAR\n\tb : INT := 4;", "out := rec.b;"),
  struct("decl_var_input_inside_struct", "U23 — a VAR_INPUT section inside a STRUCT",
    "\tVAR_INPUT\n\t\ta : INT;\n\tEND_VAR\n\tb : INT := 4;", "out := rec.b;"),
  // …and every other section keyword, one each: which of them draws the "'<Kind>' not allowed" message first
  ...["VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT", "VAR_INST", "VAR_EXTERNAL", "VAR_GLOBAL", "VAR_CONFIG", "VAR_ACCESS", "VAR_GENERIC"].map(
    (kw) =>
      struct(`decl_${kw.toLowerCase()}_inside_struct`, `U23 — a ${kw} section inside a STRUCT`,
        `\t${kw}\n\t\ta : INT;\n\tEND_VAR\n\tb : INT := 4;`, "out := rec.b;"),
  ),
]
