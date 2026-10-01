/**
 * THE TYPE EXPRESSIONS, RULE BY RULE — design.md §4 2.3 of openspec `frontend-conformance` (T1–T11, task 2.3.6), each
 * rule put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words,
 * `record:exec` for the VALUE a declaration of that type holds (every fixture below that builds copies what it declares
 * into `out`, a variable of the FB, so the run recording holds `inst_<name>.out`). Rows already decided by a recorded
 * fixture elsewhere keep those fixtures; what is here is the cells that separate a rule's readings.
 *
 * NO VARIABLE IS NAMED `s`, `r` or `st`: those are the IL operators S, R and ST, reserved words, and a declaration of one
 * measures the reserved name, not its type.
 *
 * ONE QUESTION PER FIXTURE, as in `declarations.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.3 (type expressions)"

/** Why an `ARRAY[*]` VAR_INPUT of a routine is not lowered (CODESYS builds and runs both, TwinCAT refuses both). */
const OPEN_ARRAY_INPUT =
  "an `ARRAY[*]` VAR_INPUT of a FUNCTION or METHOD, indexed: lowering lends an open array only as a VAR_IN_OUT slice (design §26), so `a[1]` is `place-shape`; niche: accepted loss (0 occurrences in the corpora — their 36 `ARRAY[*]` are all VAR_IN_OUT) (2026-10-01)"

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

/** One `VAR … END_VAR` section holding `decl` beside `out : INT`, and `body`. */
function inVar(name: string, feature: string, decl: string, body: string): LanguageTest {
  return fb(name, feature, `VAR\n${decl}\n\tout : INT;\nEND_VAR`, body)
}

/** `inVar` with a `VAR CONSTANT` section declaring `constants` before it. */
function withConstants(name: string, feature: string, constants: string, decl: string, body: string): LanguageTest {
  return fb(name, feature, `VAR CONSTANT\n${constants}\nEND_VAR\nVAR\n${decl}\n\tout : INT;\nEND_VAR`, body)
}

/** `fb` with `types` (whole TYPE declarations) written before it — an FB whose declarations use a DUT of their own. */
function withTypes(name: string, feature: string, types: string, sections: string, body: string): LanguageTest {
  const t = fb(name, feature, sections, body)
  return { ...t, source: `${types}\n${t.source}` }
}

/** A `TYPE DUT_LANG_<name> : <body> END_TYPE` DUT of `kind`, and an FB holding one (`e`) whose body is `body`. */
function dut(name: string, feature: string, kind: "enum", typeBody: string, body: string): LanguageTest {
  return withTypes(name, feature, `TYPE DUT_LANG_${name} :\n${typeBody}\nEND_TYPE\n`,
    `VAR\n\te : DUT_LANG_${name};\n\tout : INT;\nEND_VAR`, body)
}

export const TYPE_EXPRESSION_RULE_TESTS: readonly LanguageTest[] = [
  // ─── T1 a named type ────────────────────────────────────────────────────────────────────────────────────────────────
  inVar("decl_type_missing", "T1 — a declaration with no type: `v : ;`", "\tv : ;", "out := 1;"),
  // …and other punctuation where the type stands (task 2.3b review: only `;` was measured)
  inVar("decl_type_open_bracket", "T1 — a `[` where the type stands: `v : [;`", "\tv : [;", "out := 1;"),
  inVar("decl_type_missing_before_init", "T1 — an initializer where the type stands: `v : := 5;`", "\tv : := 5;", "out := 1;"),
  inVar("decl_type_keyword", "T1 — a keyword where the type stands: `v : END_IF;`", "\tv : END_IF;", "out := 1;"),
  {
    ...inVar("decl_type_unknown_qualified", "T1 — a qualified type naming no library: `v : NoSuchLib.T;`",
      "\tv : NoSuchLib.T;", "out := 1;"),
    deferred: {
      lsp: "both vendors \"Unknown type: 'NoSuchLib.T'\"; `unknownTypeName` judges a bare name only, a qualified one needs the library namespaces' type lists — LB1–LB9, task 3.4.2 (2026-10-01)",
    },
  },

  // ─── T2 subranges ───────────────────────────────────────────────────────────────────────────────────────────────────
  inVar("decl_subrange_reversed", "T2 — a subrange whose bounds are reversed: `INT(10..0)`", "\tv : INT(10..0);", "out := v;"),
  withConstants("decl_subrange_constant_bounds", "T2 — a subrange bounded by named constants: `INT(LO..HI)`",
    "\tLO : INT := 2;\n\tHI : INT := 8;", "\tv : INT(LO..HI) := 5;", "out := v;"),
  inVar("decl_subrange_on_real", "T2 — a subrange of a REAL: `REAL(0..1)`", "\tv : REAL(0..1);", "out := 1;"),
  inVar("decl_subrange_one_bound", "T2 — parentheses after an elementary type holding one value: `INT(5)`",
    "\tv : INT(5);", "out := v;"),
  // …which types take a subrange at all: a bit string, BOOL, an alias of INT; and one value in a REAL's parentheses
  inVar("decl_subrange_on_byte", "T2 — a subrange of a bit string: `BYTE(0..5)`", "\tv : BYTE(0..5);", "out := 1;"),
  inVar("decl_subrange_on_bool", "T2 — a subrange of BOOL: `BOOL(0..1)`", "\tv : BOOL(0..1);", "out := 1;"),
  withTypes("decl_subrange_on_alias", "T2 — a subrange of an alias of INT: `A(0..5)`",
    "TYPE DUT_LANG_decl_subrange_on_alias : INT;\nEND_TYPE\n",
    "VAR\n\tv : DUT_LANG_decl_subrange_on_alias(0..5);\n\tout : INT;\nEND_VAR", "out := 1;"),
  // …and the types the rule was generalized to without a measurement (task 2.3b review): a duration, a date, the
  // platform integers
  inVar("decl_subrange_on_time", "T2 — a subrange of TIME: `TIME(T#1S..T#2S)`", "\tv : TIME(T#1S..T#2S);", "out := 1;"),
  inVar("decl_subrange_on_date", "T2 — a subrange of DATE: `DATE(D#2020-01-01..D#2020-12-31)`",
    "\tv : DATE(D#2020-01-01..D#2020-12-31);", "out := 1;"),
  inVar("decl_subrange_on_xint", "T2 — a subrange of __XINT: `__XINT(0..5)`", "\tv : __XINT(0..5);", "out := 1;"),
  inVar("decl_subrange_on_uxint", "T2 — a subrange of __UXINT: `__UXINT(0..5)`", "\tv : __UXINT(0..5);", "out := 1;"),
  inVar("decl_subrange_on_xword", "T2 — a subrange of __XWORD: `__XWORD(0..5)`", "\tv : __XWORD(0..5);", "out := 1;"),
  inVar("decl_subrange_one_bound_real", "T2/T3 — parentheses after REAL holding one value: `REAL(5)`",
    "\tv : REAL(5);", "out := 1;"),
  {
    ...inVar("decl_subrange_unsigned", "T2 — a subrange of an unsigned type: `UINT(1..5)`, the default its lower bound?",
      "\tv : UINT(1..5);", "out := UINT_TO_INT(v);"),
    deferred: {
      transpile:
        "a subrange variable with no initializer starts at its LOWER BOUND: CODESYS runs `v : UINT(1..5)` as 1, both backends as 0 — the subrange's default is the Type model's (DT3, task 4.7.1; T hand-off for `defaultValueOf`); not niche, 83 subrange declarations without an initializer in the corpora (2026-10-01)",
    },
  },

  // ─── T3 FB_Init arguments on the type ───────────────────────────────────────────────────────────────────────────────
  withTypes("decl_fb_init_empty_parens", "T3 — a function block instance with empty parentheses: `inst : FB();`",
    "FUNCTION_BLOCK FB_LANG_decl_fb_init_empty_parens_inner\nVAR_OUTPUT\n\tq : INT := 3;\nEND_VAR\nEND_FUNCTION_BLOCK\n",
    "VAR\n\tinner : FB_LANG_decl_fb_init_empty_parens_inner();\n\tout : INT;\nEND_VAR", "out := inner.q;"),

  // ─── T4 arrays ──────────────────────────────────────────────────────────────────────────────────────────────────────
  inVar("decl_array_reversed_bounds", "T4 — an array whose bounds are reversed: `ARRAY[5..1] OF INT`",
    "\ta : ARRAY[5..1] OF INT;", "out := 1;"),
  inVar("decl_array_single_bound", "T4 — an array dimension with one bound: `ARRAY[5] OF INT`", "\ta : ARRAY[5] OF INT;", "out := 1;"),
  // …and the refused variable USED: what a refused dimension costs the statements that name it (task 2.3b review)
  inVar("decl_array_single_bound_used", "T4 — an array with one bound, written and read: `ARRAY[5] OF INT`, `a[1] := 2`",
    "\ta : ARRAY[5] OF INT;\n\ti : INT;", "a[1] := 2;\ni := a[1];\nout := i;"),
  inVar("decl_array_missing_of", "T4 — an array without OF: `ARRAY[0..1] INT`", "\ta : ARRAY[0..1] INT;", "out := 1;"),
  inVar("decl_array_empty_dims", "T4 — an array with no dimension: `ARRAY[] OF INT`", "\ta : ARRAY[] OF INT;", "out := 1;"),
  // (typed literals: the bound and the index typed apart from area 4's untyped-literal rule — the untyped form real code
  // writes is held out, see "THREE FIXTURES HELD OUT" under T6)
  inVar("decl_array_both_negative", "T4 — an array of negative indices: `ARRAY[INT#-3..INT#-1] OF INT`",
    "\ta : ARRAY[INT#-3..INT#-1] OF INT;", "a[INT#-2] := 6;\nout := a[INT#-2];"),
  inVar("decl_array_star_in_var", "T4 — a variable-length dimension in a plain VAR: `ARRAY[*] OF INT`",
    "\ta : ARRAY[*] OF INT;", "out := 1;"),
  // …and the two inputs the vendors' sentences tell apart: a function block's VAR_INPUT (REFUSED on both — "only possible
  // as VAR_IN_OUT of function blocks or as VAR_IN_OUT and VAR_INPUT of methods and functions") and a FUNCTION's VAR_INPUT
  fb("decl_array_star_in_fb_input", "T4 — a variable-length dimension in a function block's VAR_INPUT",
    "VAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := 1;"),
  {
    name: "decl_array_star_in_function_input",
    pouName: "FUN_LANG_decl_array_star_in_function_input",
    kind: "function",
    feature: "T4 — a variable-length dimension in a FUNCTION's VAR_INPUT, called with a two-element array",
    fromDoc: doc,
    plcPrgVar: "arr_decl_array_star_in_function_input : ARRAY[0..1] OF INT := [4, 5];\n\tres_decl_array_star_in_function_input : INT;",
    plcPrgBody: "res_decl_array_star_in_function_input := FUN_LANG_decl_array_star_in_function_input(arr_decl_array_star_in_function_input);",
    source:
      "FUNCTION FUN_LANG_decl_array_star_in_function_input : INT\nVAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR\nFUN_LANG_decl_array_star_in_function_input := a[1];\nEND_FUNCTION\n",
    deferred: { transpile: OPEN_ARRAY_INPUT },
  },
  inVar("decl_array_mixed_star", "T4 — a fixed and a variable-length dimension together: `ARRAY[0..1, *] OF INT`",
    "\ta : ARRAY[0..1, *] OF INT;", "out := 1;"),
  inVar("decl_array_star_then_fixed", "T4 — a variable-length dimension, then a fixed one: `ARRAY[*, 0..1] OF INT`",
    "\ta : ARRAY[*, 0..1] OF INT;", "out := 1;"),
  inVar("decl_array_two_stars", "T4 — two variable-length dimensions in a plain VAR: `ARRAY[*, *] OF INT`",
    "\ta : ARRAY[*, *] OF INT;", "out := 1;"),

  // ─── T5 array bounds from constants ─────────────────────────────────────────────────────────────────────────────────
  withConstants("decl_array_bound_constant_expression", "T5 — an array bound computed from a named constant: `[0..N-INT#1]`",
    "\tN : INT := 4;", "\ta : ARRAY[0..N-INT#1] OF INT;", "a[N-INT#1] := 7;\nout := a[3];"),
  inVar("decl_array_bound_variable", "T5 — an array bound naming a VARIABLE: `ARRAY[0..n] OF INT`",
    "\tn : INT := 3;\n\ta : ARRAY[0..n] OF INT;", "out := 1;"),

  // ─── T6 ARRAY OF ARRAY, POINTER TO POINTER ──────────────────────────────────────────────────────────────────────────
  inVar("decl_array_of_array", "T6 — an ARRAY OF ARRAY, written and read element by element: `a[1][2]`",
    "\ta : ARRAY[0..1] OF ARRAY[0..2] OF INT;", "a[1][2] := 5;\nout := a[1][2];"),
  inVar("decl_array_of_array_comma_index", "T6 — an ARRAY OF ARRAY indexed as if two-dimensional: `a[1, 2]`",
    "\ta : ARRAY[0..1] OF ARRAY[0..2] OF INT;", "a[1, 2] := 5;\nout := 1;"),
  // (declared only — the POINTER TO POINTER used is held out, below)
  inVar("decl_pointer_to_pointer", "T6 — a POINTER TO POINTER declared: `pp : POINTER TO POINTER TO INT;`",
    "\tpp : POINTER TO POINTER TO INT;", "out := 1;"),
  // THREE FIXTURES HELD OUT, and they need the owner (task 2.3b review, recorded 2026-10-01 on both vendors). The review
  // asked for the forms real code writes, and each was written and recorded — and each would raise a census ceiling
  // (`test/frontend/baselines/ceilings.json`, which may only fall) on BOTH vendors, so, as `literals.ts`'s A2 fixture, it
  // goes back with its recordings once the owner accepts that rise or area 4 types what it rises on:
  //   decl_array_negative_untyped           `a : ARRAY[-3..-1] OF INT;` / `a[-2] := 6; out := a[-2];` — both vendors build,
  //                                         CODESYS runs out = 6, a[-2] = 6; the LSP agrees, lowering confirms. Rises
  //                                         `unary UNKNOWN` by 4: `-<untyped literal>` has no type before area 4's literal rule.
  //   decl_array_bound_constant_minus_one   `VAR CONSTANT N : INT := 4;` / `a : ARRAY[0..N-1] OF INT;` / `a[N-1] := 7;
  //                                         out := a[3];` — both build, CODESYS runs out = 7; the LSP agrees, lowering
  //                                         confirms. Rises `binary UNKNOWN` by 2 (`N - 1`, an untyped operand, area 4).
  //   decl_pointer_to_pointer_deref         `x : INT; p : POINTER TO INT; pp : POINTER TO POINTER TO INT;` /
  //                                         `p := ADR(x); pp := ADR(p); pp^^ := 5; out := x;` — both build, CODESYS runs
  //                                         x = out = 5; the LSP agrees; lowering REFUSED it ("the address of a variable of
  //                                         another type", fixed in `pointers.ts`, `lower.test.ts`) and then confirmed it.
  //                                         Rises `call UNKNOWN, SIZEOF or ADR` by 2 (ADR's result type, task 4.3.4).
  // Until then T6's POINTER TO POINTER is an open GAP (`test/frontend/rules.ts`): a declaration alone decides nothing.

  // ─── T7 POINTER TO / REFERENCE TO ───────────────────────────────────────────────────────────────────────────────────
  inVar("decl_pointer_missing_to", "T7 — POINTER without TO: `p : POINTER INT;`", "\tp : POINTER INT;", "out := 1;"),
  inVar("decl_reference_to_reference", "T7 — a REFERENCE TO REFERENCE", "\trf : REFERENCE TO REFERENCE TO INT;", "out := 1;"),
  inVar("decl_pointer_to_reference", "T7 — a POINTER TO REFERENCE", "\tp : POINTER TO REFERENCE TO INT;", "out := 1;"),
  inVar("decl_array_of_reference", "T7 — an ARRAY OF REFERENCE", "\ta : ARRAY[0..1] OF REFERENCE TO INT;", "out := 1;"),
  inVar("decl_reference_to_array", "T7 — a REFERENCE TO an ARRAY, read through",
    "\tarr : ARRAY[0..1] OF INT := [3, 4];\n\trf : REFERENCE TO ARRAY[0..1] OF INT REF= arr;", "out := rf[1];"),

  // ─── T8 STRING(n), WSTRING(n) ───────────────────────────────────────────────────────────────────────────────────────
  inVar("decl_string_zero_length", "T8 — a STRING of length zero: `STRING(0)`", "\tstr : STRING(0);", "out := 1;"),
  inVar("decl_wstring_length", "T8 — a WSTRING(3) assigned a longer literal: is it cut to three characters?",
    "\tw : WSTRING(3);", "w := \"abcdef\";\nIF w = \"abc\" THEN out := 1; ELSE out := 2; END_IF"),
  inVar("decl_string_length_expression", "T8 — a STRING length written as an expression of literals: `STRING(2+3)`",
    "\tstr : STRING(2+3);", "str := 'abcdefgh';\nIF str = 'abcde' THEN out := 1; ELSE out := 2; END_IF"),

  // ─── T9 STRING[n], a length from a constant ─────────────────────────────────────────────────────────────────────────
  inVar("decl_string_brackets", "T9 — a STRING length in brackets: `STRING[5]`",
    "\tstr : STRING[5];", "str := 'abcdefgh';\nIF str = 'abcde' THEN out := 1; ELSE out := 2; END_IF"),
  inVar("decl_wstring_brackets", "T9 — a WSTRING length in brackets: `WSTRING[3]`",
    "\tw : WSTRING[3];", "w := \"abcdef\";\nIF w = \"abc\" THEN out := 1; ELSE out := 2; END_IF"),
  withConstants("decl_string_length_constant", "T9 — a STRING length from a named constant: `STRING(N)`",
    "\tN : INT := 5;", "\tstr : STRING(N);", "str := 'abcdefgh';\nIF str = 'abcde' THEN out := 1; ELSE out := 2; END_IF"),
  withConstants("decl_string_length_constant_brackets", "T9 — a STRING length from a named constant in brackets: `STRING[N]`",
    "\tN : INT := 5;", "\tstr : STRING[N];", "str := 'abcdefgh';\nIF str = 'abcde' THEN out := 1; ELSE out := 2; END_IF"),
  inVar("decl_string_length_variable", "T9 — a STRING length naming a VARIABLE: `STRING(n)`",
    "\tn : INT := 5;\n\tstr : STRING(n);", "out := 1;"),
  inVar("decl_string_brackets_mismatched", "T9 — a STRING length opened with `(` and closed with `]`: `STRING(5]`",
    "\tstr : STRING(5];", "out := 1;"),
  inVar("decl_string_brackets_mismatched_other", "T9 — a STRING length opened with `[` and closed with `)`: `STRING[5)`",
    "\tstr : STRING[5);", "out := 1;"),
  inVar("decl_wstring_brackets_mismatched", "T9 — a WSTRING length opened with `(` and closed with `]`: `WSTRING(3]`",
    "\tw : WSTRING(3];", "out := 1;"),

  // ─── T10 implicit enums ─────────────────────────────────────────────────────────────────────────────────────────────
  inVar("decl_implicit_enum_with_base", "T10 — an implicit enum with a base type: `e : (ie_a, ie_b := 300, ie_c) INT;`",
    "\te : (ie_a, ie_b := 300, ie_c) INT;", "e := ie_c;\nout := e;"),
  inVar("decl_implicit_enum_with_init", "T10 — an implicit enum initialized to one of its values: `e : (ii_a, ii_b) := ii_b;`",
    "\te : (ii_a, ii_b) := ii_b;", "out := e;"),
  inVar("decl_implicit_enum_next_value", "T10 — an implicit enum value after one with a value: `(nv_a := 5, nv_b)`",
    "\te : (nv_a := 5, nv_b);", "e := nv_b;\nout := e;"),
  inVar("decl_implicit_enum_empty", "T10 — an implicit enum with no value: `e : ();`", "\te : ();", "out := 1;"),
  inVar("decl_implicit_enum_trailing_comma", "T10 — an implicit enum ending in a comma: `(tc_a, tc_b,)`",
    "\te : (tc_a, tc_b,);", "out := 1;"),
  inVar("decl_implicit_enum_number_name", "T10 — an implicit enum whose second value is a number: `(nn_a, 5)`",
    "\te : (nn_a, 5);", "out := 1;"),
  inVar("decl_implicit_enum_duplicate", "T10 — an implicit enum naming one value twice: `(du_a, du_a)`",
    "\te : (du_a, du_a);", "out := 1;"),
  inVar("decl_implicit_enum_missing_close", "T10 — an implicit enum without its `)`: `e : (mc_a, mc_b;`",
    "\te : (mc_a, mc_b;", "out := 1;"),
  inVar("decl_implicit_enum_in_array", "T10 — an ARRAY OF an implicit enum: `ARRAY[0..1] OF (ia_a, ia_b)`",
    "\ta : ARRAY[0..1] OF (ia_a, ia_b);", "a[1] := ia_b;\nout := a[1];"),
  fb("decl_implicit_enum_in_var_input", "T10 — an implicit enum in a VAR_INPUT: `mode : (vi_a, vi_b);`",
    "VAR_INPUT\n\tmode : (vi_a, vi_b) := vi_b;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := mode;"),
  withTypes("decl_implicit_enum_in_struct", "T10 — an implicit enum as a STRUCT field",
    "TYPE DUT_LANG_decl_implicit_enum_in_struct :\nSTRUCT\n\tf : (is_a, is_b);\nEND_STRUCT\nEND_TYPE\n",
    "VAR\n\trec : DUT_LANG_decl_implicit_enum_in_struct;\n\tout : INT;\nEND_VAR", "rec.f := is_b;\nout := rec.f;"),
  // …and the TYPE enum, whose values the same one parser reads (task 2.3.6)
  dut("decl_type_enum_trailing_comma", "T10 — a TYPE enum ending in a comma: `(te_a, te_b,)`", "enum", "(te_a, te_b,);", "out := 1;"),
  dut("decl_type_enum_number_name", "T10 — a TYPE enum whose second value is a number: `(tn_a, 5)`", "enum", "(tn_a, 5);", "out := 1;"),
  dut("decl_type_enum_empty", "T10 — a TYPE enum with no value: `()`", "enum", "();", "out := 1;"),

  // …a value followed by neither `,` nor `)`, in each list (task 2.3b review: TwinCAT's words were said on both vendors)
  inVar("decl_implicit_enum_missing_comma", "T10 — an implicit enum's two values without a comma: `(mm_a mm_b)`",
    "\te : (mm_a mm_b);", "out := 1;"),
  dut("decl_type_enum_missing_comma", "T10 — a TYPE enum's two values without a comma: `(tm_a tm_b)`", "enum", "(tm_a tm_b);", "out := 1;"),
  dut("decl_type_enum_value_then_name", "T10 — a TYPE enum's valued value, then a name without a comma: `(tv_a := 1 tv_b)`",
    "enum", "(tv_a := 1 tv_b);", "out := 1;"),
  // …and an implicit enum's value STORED elsewhere (task 2.3b review: a TYPE enum's is checked)
  inVar("decl_implicit_enum_into_byte", "T10 — an implicit enum's value stored into a BYTE: `bt := xb_a;`",
    "\te : (xb_a, xb_b);\n\tbt : BYTE;", "bt := xb_a;\nout := 1;"),
  inVar("decl_implicit_enum_with_base_into_byte", "T10 — a DINT-based implicit enum's value stored into a BYTE",
    "\te : (xw_a, xw_b) DINT;\n\tbt : BYTE;", "bt := xw_a;\nout := 1;"),
  inVar("decl_implicit_enum_cross_assign", "T10 — one implicit enum's value stored into another implicit enum",
    "\te1 : (xc_a, xc_b);\n\te2 : (xc_c, xc_d);", "e1 := xc_c;\nout := 1;"),

  // ─── T4 where an ARRAY[*] may stand, nested (task 2.3b review: only a top-level one was asked) ─────────────────────
  inVar("decl_array_star_nested_in_var", "T4 — a variable-length ARRAY nested in an ARRAY, in a plain VAR",
    "\ta : ARRAY[0..1] OF ARRAY[*] OF INT;", "out := 1;"),
  fb("decl_array_star_nested_in_inout", "T4 — a variable-length ARRAY nested in an ARRAY, in a VAR_IN_OUT",
    "VAR_IN_OUT\n\ta : ARRAY[0..1] OF ARRAY[*] OF INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := 1;"),
  inVar("decl_pointer_to_array_star_in_var", "T4 — a POINTER TO a variable-length ARRAY, in a plain VAR",
    "\tp : POINTER TO ARRAY[*] OF INT;", "out := 1;"),
  withTypes("decl_array_star_struct_field", "T4 — a variable-length ARRAY as a STRUCT field",
    "TYPE DUT_LANG_decl_array_star_struct_field :\nSTRUCT\n\tf : ARRAY[*] OF INT;\nEND_STRUCT\nEND_TYPE\n",
    "VAR\n\trec : DUT_LANG_decl_array_star_struct_field;\n\tout : INT;\nEND_VAR", "out := 1;"),
  {
    ...fb("decl_array_star_in_method_input", "T4 — a variable-length dimension in a METHOD's VAR_INPUT, called with a two-element array",
      "VAR\n\tarr : ARRAY[0..1] OF INT := [4, 5];\n\tout : INT;\nEND_VAR", "out := M(arr);"),
    source:
      "FUNCTION_BLOCK FB_LANG_decl_array_star_in_method_input\nVAR\n\tarr : ARRAY[0..1] OF INT := [4, 5];\n\tout : INT;\nEND_VAR\nout := M(arr);\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR\nM := a[1];\nEND_METHOD\n",
    deferred: { transpile: OPEN_ARRAY_INPUT },
  },

  // ─── T11 __VECTOR ───────────────────────────────────────────────────────────────────────────────────────────────────
  withConstants("decl_vector_constant_size", "T11 — a __VECTOR sized by a named constant: `__VECTOR[N] OF REAL`",
    "\tN : INT := 3;", "\tv : __VECTOR[N] OF REAL;", "v[2] := 4.0;\nout := REAL_TO_INT(v[2]);"),
  inVar("decl_vector_of_int", "T11 — a __VECTOR of an integer type: `__VECTOR[4] OF INT`",
    "\tv : __VECTOR[4] OF INT;", "v[1] := 3;\nout := v[1];"),
  inVar("decl_vector_of_bool", "T11 — a __VECTOR of BOOL", "\tv : __VECTOR[4] OF BOOL;", "out := 1;"),
]
