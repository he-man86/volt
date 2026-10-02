/**
 * ERROR RECOVERY, RULE BY RULE — design.md §4 2.8 of openspec `frontend-conformance` (R1–R6; tasks 2.8.1–2.8.3), each
 * rule put to the vendor by fixtures of its own. Every fixture here is REFUSED by the vendor (that is the question: what
 * it says, and what it says next), so `record:language` is the oracle and nothing is run.
 *
 *   R1  a statement without its `;` — before a name, before a keyword, before a block closer, at the end of the body;
 *   R2  a block keyword missing — THEN (IF, ELSIF), OF, TO, DO (FOR, WHILE), UNTIL — and a block left open: END_IF,
 *       END_CASE, END_FOR, END_WHILE, END_REPEAT at the end of the body, and a block closed by another block's closer;
 *   R4  a token outside every unit — after the unit's END_*, before its header — and the Volt-worded messages of the
 *       units' own recovery (a stray inside an INTERFACE, a STRUCT / VAR left open);
 *   R5  an operand missing, for every kind of token that can stand where it belongs — `;`, `)`, `]`, `,`, an operator,
 *       the end of the body, a keyword — and the other Volt-worded token descriptions (a type position holding a
 *       literal, a member name missing after `.`, JMP without its label);
 *   R6  the cascade after a refused word: an elementary TYPE name and a standard FUNCTION name where a name or an operand
 *       belongs, an IL operator meeting the cascade, a refused name in a declaration, an unknown literal prefix.
 *
 * R3 (a broken declaration's cascade) keeps its recorded fixtures (`cc4_type_name_*`, `identifier_double_underscore`).
 *
 * ONE QUESTION PER FIXTURE, as in `statements.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule. No variable is named after an IL operator or a type unless that is the
 * question.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.8 (error recovery)"

/** A function block `FB_LANG_<name>` whose VAR section is `vars` and whose body is `body`; `before` (whole units) is
 *  written ahead of it, `after` (text outside every unit) behind it. */
function fb(name: string, feature: string, vars: string, body: string, before = "", after = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${after}`,
  }
}

/** A function block whose text is pushed AS SENT — `text(pouName)` is the whole object, IMPLEMENTATION line included:
 *  the parser cannot split it where the question stands. */
function sent(name: string, feature: string, text: (pouName: string) => string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    asSent: "the parser cannot split this text where the question stands; it is pushed as a workspace file holds it",
    source: text(pouName),
  }
}

/** The push's refusal of `token` after the unit's END_FUNCTION_BLOCK (line 8 of every such fixture here), both vendors. */
function refusedAfter(t: LanguageTest, token: string): LanguageTest {
  const reason = `'${t.pouName}', line 8: expected METHOD/ACTION/PROPERTY, got: ${token}`
  return {
    ...t,
    vendorRefuses: { codesys: reason, twincat: reason },
    // END_FUNCTION_BLOCK is a line of Volt's file format, which the push strips: no IDE ever holds text after it
    execSkip: "NOTHING TO MEASURE — the push refuses text after the unit's END_FUNCTION_BLOCK on both vendors, a line of Volt's file format no IDE holds, so there is no compiled object to run (recorded 2026-10-02)",
  }
}

const xOut ="\tx : BOOL;\n\tout : INT;"
const xyOut = "\tx : BOOL;\n\ty : BOOL;\n\tout : INT;"
const aOut = "\ta : INT := 1;\n\tout : INT;"
const iOut = "\ti : INT;\n\tout : INT;"
const nOut = "\tn : INT;\n\tout : INT;"

/** A FUNCTION `FUN_LANG_<name> : INT` with inputs `x`, `y`, written ahead of the FB. */
function adder(name: string): string {
  return `FUNCTION FUN_LANG_${name} : INT\nVAR_INPUT\n\tx : INT;\n\ty : INT;\nEND_VAR\nFUN_LANG_${name} := x * INT#10 + y;\nEND_FUNCTION\n\n`
}

export const RECOVERY_TESTS: LanguageTest[] = [
  // ─── R1 a statement without its `;` ────────────────────────────────────────────────────────────────────────────────
  fb("rec_missing_semicolon_before_name", "R1 — a statement without its `;` before the next statement's name", nOut, "out := 1\nn := 2;"),
  fb("rec_missing_semicolon_before_keyword", "R1 — a statement without its `;` before IF", xOut, "out := 1\nIF x THEN\n\tout := 2;\nEND_IF"),
  fb("rec_missing_semicolon_before_end_if", "R1 — the last statement of a THEN branch without its `;`, before END_IF", xOut,
    "IF x THEN\n\tout := 1\nEND_IF"),
  fb("rec_missing_semicolon_at_end", "R1 — the body's last statement without its `;`", xOut, "out := 1"),

  // ─── R2 a block keyword missing ────────────────────────────────────────────────────────────────────────────────────
  fb("rec_missing_then", "R2 — IF without THEN", xOut, "IF x\n\tout := 1;\nEND_IF"),
  fb("rec_missing_then_elsif", "R2 — ELSIF without THEN", xyOut, "IF x THEN\n\tout := 1;\nELSIF y\n\tout := 2;\nEND_IF"),
  fb("rec_missing_of", "R2 — CASE without OF", aOut, "CASE a\n1: out := 1;\nEND_CASE"),
  fb("rec_missing_to", "R2 — FOR without TO", iOut, "FOR i := 1 3 DO\n\tout := i;\nEND_FOR"),
  fb("rec_missing_do", "R2 — FOR without DO", iOut, "FOR i := 1 TO 3\n\tout := out + i;\nEND_FOR"),
  fb("rec_missing_do_while", "R2 — WHILE without DO", xOut, "WHILE x\n\tx := FALSE;\nEND_WHILE"),
  fb("rec_missing_until", "R2 — REPEAT without UNTIL", xOut, "REPEAT\n\tout := 1;\nEND_REPEAT"),

  // ─── R2 a block left open, or closed by another block's closer ─────────────────────────────────────────────────────
  fb("rec_missing_end_if", "R2 — an IF left open at the end of the body", xOut, "IF x THEN\n\tout := 1;"),
  fb("rec_missing_end_case", "R2 — a CASE left open at the end of the body", aOut, "CASE a OF\n1: out := 1;"),
  fb("rec_missing_end_for", "R2 — a FOR left open at the end of the body", iOut, "FOR i := 1 TO 3 DO\n\tout := out + i;"),
  fb("rec_missing_end_while", "R2 — a WHILE left open at the end of the body", xOut, "WHILE x DO\n\tx := FALSE;"),
  fb("rec_missing_end_repeat", "R2 — a REPEAT whose UNTIL has no END_REPEAT", xOut, "REPEAT\n\tout := 1;\nUNTIL x"),
  fb("rec_missing_end_if_in_for", "R2 — an IF left open inside a FOR: END_FOR meets it", "\ti : INT;\n\tx : BOOL;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tIF x THEN\n\t\tout := i;\nEND_FOR"),
  fb("rec_end_while_closes_if", "R2 — an IF closed by END_WHILE", xOut, "IF x THEN\n\tout := 1;\nEND_WHILE"),
  // …what each block still expects once its last part is open (the list after ELSE, after ELSIF, after __CATCH)
  fb("rec_missing_end_if_after_else", "R2 — an IF left open in its ELSE at the end of the body", xOut, "IF x THEN\n\tout := 1;\nELSE\n\tout := 2;"),
  fb("rec_missing_end_if_after_elsif", "R2 — an IF left open in an ELSIF at the end of the body", xyOut,
    "IF x THEN\n\tout := 1;\nELSIF y THEN\n\tout := 2;"),
  fb("rec_missing_end_case_after_else", "R2 — a CASE left open in its ELSE at the end of the body", aOut, "CASE a OF\n1: out := 1;\nELSE\n\tout := 2;"),
  fb("rec_missing_end_try", "R2 — a __TRY left open in its __CATCH at the end of the body", xOut, "__TRY\n\tout := 1;\n__CATCH\n\tout := 2;"),
  fb("rec_missing_end_try_after_finally", "R2 — a __TRY left open in its __FINALLY at the end of the body", xOut,
    "__TRY\n\tout := 1;\n__CATCH\n\tout := 2;\n__FINALLY\n\tout := 3;"),
  fb("rec_missing_end_try_in_try", "R2 — a __TRY left open in its own block at the end of the body", xOut, "__TRY\n\tout := 1;"),
  // …and a closer no block is open for, where a statement may start: before a statement, before its `;`
  fb("rec_stray_closer_then_statement", "R2 — END_IF with no IF open, a statement after it", xOut, "out := 1;\nEND_IF\nout := 2;"),
  fb("rec_stray_closer_semicolon", "R2 — END_FOR with no FOR open, its `;` after it", xOut, "out := 1;\nEND_FOR;"),

  // ─── R4 a token outside every unit, and the units' own recovery ────────────────────────────────────────────────────
  // THE PUSH refuses text after a unit's END_* on both vendors (recorded 2026-10-02): a workspace file holds members
  // after it and nothing else, so the answer is the file format's, not a compiler's
  refusedAfter(fb("rec_file_scope_stray", "R4 — a name after the unit's END_FUNCTION_BLOCK", "\tout : INT;", "out := 1;", "", "stray\n"), "stray"),
  refusedAfter(fb("rec_file_scope_stray_semicolon", "R4 — a `;` after the unit's END_FUNCTION_BLOCK", "\tout : INT;", "out := 1;", "", ";\n"), ";"),
  refusedAfter(fb("rec_file_scope_stray_keyword", "R4 — END_IF after the unit's END_FUNCTION_BLOCK", "\tout : INT;", "out := 1;", "", "END_IF\n"), "END_IF"),
  sent("rec_file_scope_stray_before_unit", "R4 — a name before the unit's header",
    (pou) => `stray\nFUNCTION_BLOCK ${pou}\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := 1;\nEND_FUNCTION_BLOCK\n`),
  {
    name: "rec_interface_stray",
    pouName: "ITF_LANG_rec_interface_stray",
    kind: "interface",
    feature: "R4 — a name inside an INTERFACE, where a METHOD or PROPERTY belongs",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_rec_interface_stray\nstray\nEND_INTERFACE\n",
    plcPrgVar: "itf_rec_interface_stray : ITF_LANG_rec_interface_stray;",
  },
  {
    name: "rec_unterminated_struct",
    pouName: "DUT_LANG_rec_unterminated_struct",
    kind: "struct",
    feature: "R4 — a STRUCT without its END_STRUCT",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_unterminated_struct :\nSTRUCT\n\tv : INT;\nEND_TYPE\n",
    plcPrgVar: "v_rec_unterminated_struct : DUT_LANG_rec_unterminated_struct;",
  },
  {
    name: "rec_unterminated_union",
    pouName: "DUT_LANG_rec_unterminated_union",
    kind: "union",
    feature: "R4 — a UNION without its END_UNION",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_unterminated_union :\nUNION\n\tv : INT;\n\tw : WORD;\nEND_TYPE\n",
    plcPrgVar: "v_rec_unterminated_union : DUT_LANG_rec_unterminated_union;",
  },
  {
    name: "rec_missing_end_type",
    pouName: "DUT_LANG_rec_missing_end_type",
    kind: "struct",
    feature: "R4 — a STRUCT type without its END_TYPE",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_missing_end_type :\nSTRUCT\n\tv : INT;\nEND_STRUCT\n",
    plcPrgVar: "v_rec_missing_end_type : DUT_LANG_rec_missing_end_type;",
  },
  fb("rec_unterminated_var_before_section", "R4 — a VAR section without its END_VAR, the next section after it",
    "\tout : INT;\nVAR_INPUT\n\tk : INT;", "out := k;"),
  sent("rec_unterminated_var", "R4 — a VAR section without its END_VAR",
    (pou) => `FUNCTION_BLOCK ${pou}\nVAR\n\tout : INT;\nIMPLEMENTATION ST\nout := 1;\nEND_FUNCTION_BLOCK\n`),

  // ─── R5 an operand missing: every kind of token where it belongs ───────────────────────────────────────────────────
  fb("rec_expected_expression", "R5 — an operator's right operand missing before `;`", "\tout : INT;", "out := 1 + ;"),
  fb("rec_expected_expression_paren", "R5 — an operand missing before `)`", "\tout : INT;", "out := (1 + );"),
  fb("rec_expected_expression_leading_operator", "R5 — an operator where the operand belongs", "\tout : INT;", "out := * 2;"),
  fb("rec_expected_expression_end_of_pou", "R5 — an operand missing at the end of the body", "\tout : INT;", "out := 1 +"),
  fb("rec_expected_expression_argument", "R5 — an argument missing before `,`", "\tout : INT;", "out := FUN_LANG_rec_expected_expression_argument(, 2);",
    adder("rec_expected_expression_argument")),
  fb("rec_expected_expression_index", "R5 — an index missing before `]`", "\tarr : ARRAY[0..2] OF INT;\n\tout : INT;", "out := arr[];"),
  fb("rec_expected_expression_condition", "R5 — IF with no condition: THEN where it belongs", xOut, "IF THEN\n\tout := 1;\nEND_IF"),
  fb("rec_expected_expression_initializer", "R5 — an initializer missing before `;`", "\tn : INT := ;\n\tout : INT;", "out := n;"),
  fb("rec_type_expected_literal", "R5 — a literal where a variable's type belongs", "\tv : 5;\n\tout : INT;", "out := 1;"),
  fb("rec_member_name_expected", "R5 — a member name missing after `.`", "\tbx : DUT_LANG_rec_member_name_expected;\n\tout : INT;", "out := bx.;",
    "TYPE DUT_LANG_rec_member_name_expected :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("rec_jmp_without_label", "R5 — JMP without its label", "\tout : INT;", "JMP;\nout := 1;"),

  // ─── R6 the cascade after a refused word ───────────────────────────────────────────────────────────────────────────
  fb("rec_refused_name_cascade_type_word", "R6 — an elementary type name as an operand, tokens after it", nOut, "out := n + dint + 1;\nn := 2;"),
  fb("rec_refused_name_cascade_type_word_start", "R6 — an elementary type name opening a statement", nOut, "dword := n + 1;\nn := 2;"),
  fb("rec_refused_name_cascade_function_word", "R6 — a standard function name opening a statement, a call after it", nOut,
    "limit := ABS(n) + 1;\nn := 2;"),
  fb("rec_refused_name_cascade_il_word", "R6 — the cascade after a refused IL operator meets another", nOut, "ld := n + st;\nn := 2;"),
  fb("rec_refused_name_cascade_declaration", "R6 — a refused name in a declaration, a type with brackets after it",
    "\tbit : ARRAY[0..1] OF INT;\n\tout : INT;", "out := 1;"),
  // …the cascade meeting a NAME in a declaration — a type the project knows (`TON`): paired as a token no declaration
  // starts with, or the one `;` line a name gets in a body?
  fb("rec_refused_name_declared_fb_type", "R6 — a refused IL-operator name declared with a function block type",
    "\tld : TON;\n\tout : INT;", "out := 1;"),
  fb("rec_refused_name_cascade_initializer", "R6 — a name with consecutive underscores, an initializer after it",
    "\ta__b : INT := 5;\n\tout : INT;", "out := 1;"),
  fb("rec_unknown_literal_prefix_cascade", "R6 — an unknown literal prefix, tokens after it", nOut, "out := FOO#5 + n;\nn := 2;"),
  // ─── R6 a refused word in the positions 2.8.3 did not ask (review 2.8, 2026-10-02) ────────────────────────────────
  // a label (a CASE arm's, a statement's), a JMP target, a FOR control variable, an initializer, a STRUCT/UNION field
  fb("rec_refused_word_case_label", "R6 — an elementary type name as a later CASE arm's label", nOut,
    "CASE n OF\n1: out := 1;\ndint: out := 2;\nEND_CASE"),
  fb("rec_refused_word_case_label_first", "R6 — an elementary type name as the only CASE arm's label", nOut,
    "CASE n OF\nint: out := 1;\nEND_CASE"),
  fb("rec_refused_word_body_label_type", "R6 — an elementary type name as a statement label", nOut, "dint: out := 1;"),
  fb("rec_refused_word_body_label_il", "R6 — an IL operator as a statement label", nOut, "st: out := 1;"),
  fb("rec_refused_word_jmp_target", "R6 — an IL operator as a JMP target", nOut, "JMP ld;\nout := 1;"),
  fb("rec_jmp_keyword_target", "R5 — a keyword as a JMP target", nOut, "JMP END_IF;\nout := 1;"),
  fb("rec_refused_word_for_variable", "R6 — an elementary type name as a FOR control variable", nOut,
    "FOR int := 1 TO 3 DO\n\tout := 1;\nEND_FOR"),
  fb("rec_refused_word_initializer", "R6 — an elementary type name as an operand of an initializer",
    "\tx : INT := 1 + word;\n\tout : INT;", "out := x;"),
  fb("rec_refused_word_initializer_alone", "R6 — an elementary type name as a whole initializer",
    "\tx : INT := dint;\n\tout : INT;", "out := x;"),
  {
    name: "rec_refused_word_struct_field",
    pouName: "DUT_LANG_rec_refused_word_struct_field",
    kind: "struct",
    feature: "R6 — an elementary type name as a STRUCT field's name",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_refused_word_struct_field :\nSTRUCT\n\tword : WORD;\n\tb : BYTE;\nEND_STRUCT\nEND_TYPE\n",
    plcPrgVar: "v_rec_refused_word_struct_field : DUT_LANG_rec_refused_word_struct_field;",
  },
  {
    name: "rec_refused_word_struct_field_il",
    pouName: "DUT_LANG_rec_refused_word_struct_field_il",
    kind: "struct",
    feature: "R6 — an IL operator as a STRUCT field's name",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_refused_word_struct_field_il :\nSTRUCT\n\tr : INT;\n\tb : BYTE;\nEND_STRUCT\nEND_TYPE\n",
    plcPrgVar: "v_rec_refused_word_struct_field_il : DUT_LANG_rec_refused_word_struct_field_il;",
  },
  {
    name: "rec_refused_word_union_field",
    pouName: "DUT_LANG_rec_refused_word_union_field",
    kind: "union",
    feature: "R6 — an elementary type name as a UNION field's name",
    fromDoc: doc,
    source: "TYPE DUT_LANG_rec_refused_word_union_field :\nUNION\n\tword : WORD;\n\tb : BYTE;\nEND_UNION\nEND_TYPE\n",
    plcPrgVar: "v_rec_refused_word_union_field : DUT_LANG_rec_refused_word_union_field;",
  },
  // …a `__` operator the vocabulary does not list, leading an initializer (TwinCAT documents `__TRY_CAST`)
  fb("rec_dunder_try_cast_initializer", "R6 — `__TRY_CAST` leading an initializer",
    "\ta : POINTER TO INT;\n\tb : POINTER TO INT;\n\tp : POINTER TO INT := __TRY_CAST(a, b);\n\tout : INT;", "out := 1;"),
  // …the cascade after a refused word meeting a `.` and a name; a member name that is a punctuation mark, or missing
  fb("rec_refused_word_member_cascade", "R6 — an IL operator as an operand, a member access after it", nOut, "out := st.x;\nn := 2;"),
  fb("rec_member_name_punct", "R5 — a `(` where a member name belongs", "\tbx : DUT_LANG_rec_member_name_punct;\n\tout : INT;",
    "out := bx.(1);", "TYPE DUT_LANG_rec_member_name_punct :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("rec_member_name_at_end", "R5 — a member name missing at the end of the body",
    "\tbx : DUT_LANG_rec_member_name_at_end;\n\tout : INT;", "out := bx.",
    "TYPE DUT_LANG_rec_member_name_at_end :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  {
    name: "rec_interface_stray_keyword",
    pouName: "ITF_LANG_rec_interface_stray_keyword",
    kind: "interface",
    feature: "R4 — a keyword inside an INTERFACE, where a METHOD or PROPERTY belongs",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_rec_interface_stray_keyword\nEND_IF\nEND_INTERFACE\n",
    plcPrgVar: "itf_rec_interface_stray_keyword : ITF_LANG_rec_interface_stray_keyword;",
  },
  // …a type name whose `.` has no name behind it
  fb("rec_type_name_dot_dangling", "R5 — a type name ending in a `.`", "\tv : DUT_LANG_rec_type_name_dot_dangling.;\n\tout : INT;",
    "out := 1;", "TYPE DUT_LANG_rec_type_name_dot_dangling :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
]
