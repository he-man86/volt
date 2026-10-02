/**
 * THE EXPRESSIONS, RULE BY RULE — design.md §4 2.5 of openspec `frontend-conformance` (E1–E34; tasks 2.5.1–2.5.6), each rule put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's
 * words, `record:exec` for the VALUE an expression computes (every fixture below that builds copies its expression into
 * `out`, a variable of the FB, so the run recording holds `inst_<name>.out`). Rows already decided by a recorded fixture
 * elsewhere keep those fixtures; what is here is the cells that separate a rule's readings — for a precedence or an
 * associativity, operands whose two groupings give different values (or one grouping a type error), so the recording
 * says which grouping the vendor reads.
 *
 * NO VARIABLE IS NAMED `s`, `r` or `st` (the IL operators S, R and ST, reserved words), and the operands are VARIABLES
 * initialised in their declaration, not literals in the body: an untyped literal's type is area 4's question, and a
 * fixture asks one question.
 *
 * ONE QUESTION PER FIXTURE, as in `declarations.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.5 (expressions)"

/** A function block `FB_LANG_<name>` whose VAR section is `vars` and whose body is `body`; `before` (whole units) is
 *  written ahead of it. */
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

/** INT operands `a`, `b`, `c` holding `va`, `vb`, `vc`, and `out : INT := <expr>`. */
function ints(name: string, feature: string, [va, vb, vc]: readonly [number, number, number], expr: string): LanguageTest {
  return fb(name, feature, `\ta : INT := ${va};\n\tb : INT := ${vb};\n\tc : INT := ${vc};\n\tout : INT;`, `out := ${expr};`)
}

/** BOOL operands `a`, `b`, `c` holding `va`, `vb`, `vc`, and `out : BOOL := <expr>`. */
function bools(name: string, feature: string, [va, vb, vc]: readonly [boolean, boolean, boolean], expr: string): LanguageTest {
  const lit = (v: boolean): string => (v ? "TRUE" : "FALSE")
  return fb(name, feature, `\ta : BOOL := ${lit(va)};\n\tb : BOOL := ${lit(vb)};\n\tc : BOOL := ${lit(vc)};\n\tout : BOOL;`,
    `out := ${expr};`)
}

/** A FUNCTION `FUN_LANG_<name> : INT` with inputs `x`, `y` returning `x * INT#10 + y`, written ahead of the FB. */
function adder(name: string): string {
  return `FUNCTION FUN_LANG_${name} : INT\nVAR_INPUT\n\tx : INT;\n\ty : INT;\nEND_VAR\nFUN_LANG_${name} := x * INT#10 + y;\nEND_FUNCTION\n\n`
}

/** A STRUCT `DUT_LANG_<name>` with one field `v : INT`, written ahead of the FB. */
function box(name: string): string {
  return `TYPE DUT_LANG_${name} :\nSTRUCT\n\tv : INT := 4;\nEND_STRUCT\nEND_TYPE\n\n`
}

/** `fb` reading member `member` of a `DUT_LANG_<name>` box: `out := bx.<member>;`. */
function member(name: string, feature: string, memberText: string): LanguageTest {
  return fb(name, feature, `\tbx : DUT_LANG_${name};\n\tout : INT;`, `out := bx.${memberText};`, box(name))
}

/** A function block `FB_LANG_<name>` written whole by the caller (`source`, its methods after it). */
function fbSource(name: string, feature: string, source: string, extra: Partial<LanguageTest> = {}): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source,
    ...extra,
  }
}

/** `fb` with a global variable list `GVL_LANG_<name>` holding `globals` ahead of it (and `before` between them). */
function withGlobals(name: string, feature: string, globals: string, vars: string, body: string, before = ""): LanguageTest {
  return {
    ...fb(name, feature, vars, body, `VAR_GLOBAL
${globals}
END_VAR

${before}`),
    gvlNames: [`GVL_LANG_${name}`],
  }
}

/** `fb` reading `gAmb`, which two global lists `GVL_LANG_<name>_a` and `_b` declare, a STRUCT between them. */
function twoLists(name: string, feature: string, body: string): LanguageTest {
  const list = "VAR_GLOBAL\n\tgAmb : INT;\nEND_VAR\n\n"
  return { ...fb(name, feature, "\tout : INT;", body, list + box(name) + list), gvlNames: [`GVL_LANG_${name}_a`, `GVL_LANG_${name}_b`] }
}

/** `withGlobals` whose list is `VAR_GLOBAL CONSTANT`. */
function withConstGlobals(name: string, feature: string, globals: string, vars: string, body: string, before = ""): LanguageTest {
  const t = withGlobals(name, feature, globals, vars, body, before)
  return { ...t, source: t.source.replace(/^VAR_GLOBAL\n/, "VAR_GLOBAL CONSTANT\n") }
}

export const EXPRESSION_RULE_TESTS: readonly LanguageTest[] = [
  // ─── E1/E6 the boolean levels: OR < XOR < AND, and the short-circuit pair on AND's and OR's levels ────────────────
  // a OR (b XOR c) = TRUE; (a OR b) XOR c = FALSE
  bools("expr_xor_between_or_and", "E1/E6 — XOR binds tighter than OR: `a OR b XOR c`", [true, true, true], "a OR b XOR c"),
  // a XOR (b AND c) = TRUE; (a XOR b) AND c = FALSE
  bools("expr_and_tighter_than_xor", "E1/E6 — AND binds tighter than XOR: `a XOR b AND c`", [true, true, false], "a XOR b AND c"),
  // a OR_ELSE (b AND_THEN c) = TRUE; (a OR_ELSE b) AND_THEN c = FALSE
  bools("expr_and_then_tighter_than_or_else", "E1/E6 — AND_THEN binds tighter than OR_ELSE: `a OR_ELSE b AND_THEN c`",
    [true, false, false], "a OR_ELSE b AND_THEN c"),
  // …and since `expr_xor_between_or_and` ran FALSE — XOR does NOT bind tighter than OR — every remaining pair of the
  // boolean levels whose two groupings differ in value (OR/OR_ELSE and AND/AND_THEN are one operation each, so their
  // grouping has no value to show):
  // (a XOR b) OR c = TRUE; a XOR (b OR c) = FALSE
  bools("expr_xor_then_or", "E1/E6 — XOR then OR: `a XOR b OR c` (one level, or OR tighter?)", [true, true, true], "a XOR b OR c"),
  // (a OR_ELSE b) XOR c = FALSE; a OR_ELSE (b XOR c) = TRUE
  bools("expr_or_else_then_xor", "E1/E6 — OR_ELSE then XOR: `a OR_ELSE b XOR c`", [true, true, true], "a OR_ELSE b XOR c"),
  // (a XOR b) OR_ELSE c = TRUE; a XOR (b OR_ELSE c) = FALSE
  bools("expr_xor_then_or_else", "E1/E6 — XOR then OR_ELSE: `a XOR b OR_ELSE c`", [true, true, true], "a XOR b OR_ELSE c"),
  // a XOR (b AND_THEN c) = TRUE; (a XOR b) AND_THEN c = FALSE
  bools("expr_xor_then_and_then", "E1/E6 — XOR then AND_THEN: `a XOR b AND_THEN c`", [true, true, false], "a XOR b AND_THEN c"),
  // a OR (b AND_THEN c) = TRUE; (a OR b) AND_THEN c = FALSE
  bools("expr_or_then_and_then", "E1/E6 — OR then AND_THEN: `a OR b AND_THEN c`", [true, true, false], "a OR b AND_THEN c"),
  // a OR_ELSE (b AND c) = TRUE; (a OR_ELSE b) AND c = FALSE
  bools("expr_or_else_then_and", "E1/E6 — OR_ELSE then AND: `a OR_ELSE b AND c`", [true, true, false], "a OR_ELSE b AND c"),
  // (a = b) AND c = FALSE; a = (b AND c) = TRUE
  bools("expr_equality_tighter_than_and", "E3/E6 — `=` binds tighter than AND: `a = b AND c`", [false, false, false], "a = b AND c"),
  // (NOT a) = b: -1 = 5 is FALSE; NOT (a = b) is TRUE
  fb("expr_not_tighter_than_comparison", "E6/E10 — NOT binds tighter than `=`: `NOT a = b` on INT",
    "\ta : INT := 0;\n\tb : INT := 5;\n\tout : BOOL;", "out := NOT a = b;"),

  // ─── E3/E9 comparison levels and chains ───────────────────────────────────────────────────────────────────────────
  // (a < b) = c builds (BOOL = BOOL) and is TRUE; a < (b = c) compares an INT with a BOOL
  fb("expr_comparison_chain", "E9 — a comparison chain across levels: `a < b = c` (`<` tighter than `=`)",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tc : BOOL := TRUE;\n\tout : BOOL;", "out := a < b = c;"),
  // (a = b) = c builds and is TRUE; a = (b = c) compares an INT with a BOOL
  fb("expr_equality_chain", "E9 — an equality chain: `a = b = c` (left-associative)",
    "\ta : INT := 1;\n\tb : INT := 1;\n\tc : BOOL := TRUE;\n\tout : BOOL;", "out := a = b = c;"),
  // (a < b) < c compares a BOOL with an INT
  fb("expr_comparison_chain_same_level", "E9 — a chain on one level: `a < b < c` on INT",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tc : INT := 3;\n\tout : BOOL;", "out := a < b < c;"),

  // ─── E4/E6/E7 the arithmetic levels ───────────────────────────────────────────────────────────────────────────────
  // a + (b MOD c) = 9; (a + b) MOD c = 0
  ints("expr_mod_precedence", "E4/E6 — MOD binds tighter than `+`: `a + b MOD c`", [7, 5, 3], "a + b MOD c"),
  // (a * b) MOD c = 2; a * (b MOD c) = 6
  ints("expr_mod_same_level_as_mul", "E4/E7 — MOD on `*`'s level, left to right: `a * b MOD c`", [2, 3, 4], "a * b MOD c"),
  // (a / b) / c = 10; a / (b / c) = 50
  ints("expr_div_left_assoc", "E7 — `/` left-associative: `a / b / c`", [100, 5, 2], "a / b / c"),

  // ─── E8 `**` (refused as an operator — E5): right associativity and a unary minus before it ─────────────────────────
  ints("expr_power_right_assoc", "E5/E8 — `**` twice: `a ** b ** c`", [2, 3, 2], "a ** b ** c"),
  ints("expr_neg_power", "E5/E8 — a unary minus before `**`: `-a ** b`", [2, 2, 0], "-a ** b"),

  // ─── E10/E11 unary operators ──────────────────────────────────────────────────────────────────────────────────────
  ints("expr_unary_plus", "E11 — unary plus: `+a`", [5, 0, 0], "+a"),
  ints("expr_prefix_ampersand", "E11 — a prefix `&`: `&a`", [5, 0, 0], "&a"),
  ints("expr_double_minus", "E11 — two unary minuses apart: `- -a`", [5, 0, 0], "- -a"),
  ints("expr_minus_minus_adjacent", "E11 — two unary minuses together: `--a`", [5, 0, 0], "--a"),
  ints("expr_plus_plus", "E11 — two unary pluses: `+ +a`", [5, 0, 0], "+ +a"),
  bools("expr_not_not", "E11 — NOT twice: `NOT NOT a`", [true, false, false], "NOT NOT a"),
  ints("expr_minus_not", "E10/E11 — a minus before NOT: `-NOT a` on INT", [5, 0, 0], "-NOT a"),
  ints("expr_not_minus", "E10/E11 — NOT before a minus: `NOT -a` on INT", [5, 0, 0], "NOT -a"),
  ints("expr_minus_after_minus", "E10 — a unary minus as the right operand of `-`: `a - -b`", [5, 3, 0], "a - -b"),
  ints("expr_minus_after_mul", "E10 — a unary minus as the right operand of `*`: `a * -b`", [5, 3, 0], "a * -b"),

  // ─── E2/E5 `&` and `**` where a statement does not end at them ────────────────────────────────────────────────────
  bools("expr_ampersand_in_parens", "E2 — `&` inside parentheses: `(a & b)`", [true, true, false], "(a & b)"),
  fb("expr_ampersand_in_argument", "E2 — `&` in a call's argument: `BOOL_TO_INT(a & b)`",
    "\ta : BOOL := TRUE;\n\tb : BOOL := TRUE;\n\tout : INT;", "out := BOOL_TO_INT(a & b);"),
  fb("expr_ampersand_in_if", "E2 — `&` in an IF condition: `IF a & b THEN`",
    "\ta : BOOL := TRUE;\n\tb : BOOL := TRUE;\n\tout : INT;", "IF a & b THEN\n\tout := 1;\nEND_IF"),
  ints("expr_power_in_parens", "E5 — `**` inside parentheses: `(a ** b)`", [2, 3, 0], "(a ** b)"),
  // …and what decides the recovery after each: a user function's argument list (is the conversion's `')' expected` the
  // call's?), a stray NAME after an IF condition (does the IF skip to its THEN?), a stray name inside parentheses
  fb("expr_ampersand_in_user_call", "E2 — `&` in a user function's argument: `F(a & b, c)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tc : INT := 3;\n\tout : INT;", "out := FUN_LANG_expr_ampersand_in_user_call(a & b, c);",
    adder("expr_ampersand_in_user_call")),
  fb("expr_if_condition_stray_name", "E2 (recovery) — a stray name after an IF condition: `IF a b THEN`",
    "\ta : BOOL := TRUE;\n\tb : BOOL := TRUE;\n\tout : INT;", "IF a b THEN\n\tout := 1;\nEND_IF"),
  fb("expr_paren_stray_name", "E24 (recovery) — a stray name inside parentheses: `(a b)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := (a b);"),
  // …and the same open parenthesis where the expression is NOT a statement's: an IF's and a WHILE's condition, an index
  // (does the refusal stay in its container, or resync the statement around it?)
  fb("expr_paren_stray_name_in_if", "E24 (recovery) — a stray name inside parentheses in an IF condition: `IF (a b) THEN`",
    "\ta : BOOL := TRUE;\n\tb : BOOL := TRUE;\n\tout : INT;", "IF (a b) THEN\n\tout := 1;\nEND_IF"),
  fb("expr_paren_stray_name_in_while", "E24 (recovery) — a stray name inside parentheses in a WHILE condition: `WHILE (a b) DO`",
    "\ta : BOOL := TRUE;\n\tb : BOOL := TRUE;\n\tout : INT;", "WHILE (a b) DO\n\tout := 1;\nEND_WHILE"),
  fb("expr_paren_stray_name_in_index", "E24 (recovery) — a stray literal inside parentheses in an index: `arr[(1 2)]`",
    "\tarr : ARRAY[1..3] OF INT := [4, 5, 6];\n\tout : INT;", "out := arr[(1 2)];"),

  // ─── E15/E16 index lists and argument lists: a trailing comma, an empty list, an index of an index ────────────────
  fb("expr_trailing_comma_index", "E16 — a trailing comma in an index list: `arr[1,]`",
    "\tarr : ARRAY[1..3] OF INT := [4, 5, 6];\n\tout : INT;", "out := arr[1,];"),
  fb("expr_trailing_comma_index_2d", "E16 — a trailing comma after two indices: `grid[1, 2,]`",
    "\tgrid : ARRAY[1..2, 1..2] OF INT := [1, 2, 3, 4];\n\tout : INT;", "out := grid[1, 2,];"),
  fb("expr_index_empty", "E15 — an empty index list: `arr[]`",
    "\tarr : ARRAY[1..3] OF INT := [4, 5, 6];\n\tout : INT;", "out := arr[];"),
  fb("expr_index_of_index_on_2d", "E15 — a 2-D array indexed twice: `grid[1][2]`",
    "\tgrid : ARRAY[1..2, 1..2] OF INT := [1, 2, 3, 4];\n\tout : INT;", "out := grid[1][2];"),
  fb("expr_trailing_comma_call", "E16 — a trailing comma in a call's argument list: `F(a, b,)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := FUN_LANG_expr_trailing_comma_call(a, b,);",
    adder("expr_trailing_comma_call")),
  fb("expr_trailing_comma_formal_call", "E16 — a trailing comma after formal arguments: `F(x := a, y := b,)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := FUN_LANG_expr_trailing_comma_formal_call(x := a, y := b,);",
    adder("expr_trailing_comma_formal_call")),
  fb("expr_trailing_comma_fb_call", "E16 — a trailing comma in a function block call: `inner(x := a,)`",
    "\tinner : FB_LANG_expr_trailing_comma_fb_call_inner;\n\ta : INT := 1;\n\tout : INT;", "inner(x := a,);\nout := inner.q;",
    "FUNCTION_BLOCK FB_LANG_expr_trailing_comma_fb_call_inner\nVAR_INPUT\n\tx : INT;\nEND_VAR\nVAR_OUTPUT\n\tq : INT;\nEND_VAR\nq := x + INT#1;\nEND_FUNCTION_BLOCK\n\n"),
  {
    ...fb("expr_trailing_comma_conversion_call", "E16 — a trailing comma in a conversion's argument list: `INT_TO_DINT(a,)`",
      "\ta : INT := 1;\n\tout : DINT;", "out := INT_TO_DINT(a,);"),
    deferred: {
      lsp: "both vendors \"')' expected instead of ','\": a conversion takes ONE argument, as an operator does, and the parser cannot tell a conversion from a user FUNCTION named like one (pro2193's `RANGE_TO_WORD` takes three) — the type layer's name; niche: accepted loss (0 occurrences in the corpora) (2026-10-01)",
    },
  },
  fb("expr_trailing_comma_operator_call", "E16/E28 — a trailing comma in a keyword-named callee's list: `MAX(a, b,)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := MAX(a, b,);"),
  // …an operator of ONE operand (`CALL_OPERATOR_OPERANDS`): is its trailing comma MAX's "Expression expected" or the
  // conversion's "')' expected"? and an `&` in its argument
  fb("expr_trailing_comma_one_operand_operator", "E16/E28 — a trailing comma in a one-operand operator's list: `ABS(a,)`",
    "\ta : INT := 1;\n\tout : INT;", "out := ABS(a,);"),
  fb("expr_trailing_comma_sizeof", "E16/E28 — a trailing comma in SIZEOF's list: `SIZEOF(a,)`",
    "\ta : INT := 1;\n\tout : UDINT;", "out := SIZEOF(a,);"),
  fb("expr_ampersand_in_operator_argument", "E2/E28 — `&` in a one-operand operator's argument: `ABS(a & b)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := ABS(a & b);"),
  // …and MAX's trailing comma in a DECLARATION's initializer, not a body
  fb("expr_trailing_comma_operator_call_in_initializer",
    "E16/E28 — a trailing comma in an operator's list in an initializer: `c : INT := MAX(1, 2,);`",
    "\tc : INT := MAX(1, 2,);\n\tout : INT;", "out := c;"),

  // ─── E22 a postfix on a call result: an index (`.x` and `.0` are cc3_bit_access_and_call_result) ──────────────────
  fb("expr_call_result_index", "E22 — an index on a call result: `F()[1]`",
    "\tout : INT;", "out := FUN_LANG_expr_call_result_index()[1];",
    "FUNCTION FUN_LANG_expr_call_result_index : ARRAY[1..2] OF INT\nFUN_LANG_expr_call_result_index[1] := 7;\nEND_FUNCTION\n\n"),

  // …and whether the refusal stops the body's analysis, as a parse error does: an undefined name in the next statement
  fb("expr_call_result_index_beside_undefined", "E22 — `F()[1]`, and an undefined name in the next statement",
    "\tout : INT;", "out := FUN_LANG_expr_call_result_index_beside_undefined()[1];\nout := nope;",
    "FUNCTION FUN_LANG_expr_call_result_index_beside_undefined : ARRAY[1..2] OF INT\nFUN_LANG_expr_call_result_index_beside_undefined[1] := 7;\nEND_FUNCTION\n\n"),

  // ─── E32 a keyword where a member name belongs ────────────────────────────────────────────────────────────────────
  member("expr_member_named_keyword", "E32 — a statement keyword as a member name: `bx.END_IF`", "END_IF"),
  member("expr_member_named_operator_keyword", "E32 — an operator keyword as a member name: `bx.MOD`", "MOD"),
  member("expr_member_named_function_keyword", "E32 — a standard function's keyword as a member name: `bx.ABS`", "ABS"),
  member("expr_member_named_type_keyword", "E32 — an elementary type's keyword as a member name: `bx.INT`", "INT"),
  member("expr_member_named_soft_keyword", "E32 — a soft keyword as a member name: `bx.GET`", "GET"),
  fb("expr_member_named_keyword_beside_undefined", "E32 — `bx.END_IF`, and an undefined name in the next statement",
    "\tbx : DUT_LANG_expr_member_named_keyword_beside_undefined;\n\tout : INT;", "out := bx.END_IF;\nout := nope;",
    box("expr_member_named_keyword_beside_undefined")),
  // …and TwinCAT's `d.%W0` (no partial access there: `.` `%` `W0`), beside an undefined name: does its "'%' is no
  // component of 'd'" stop the body's analysis as `bx.END_IF`'s does? (CODESYS reads `.%W0` as a partial access.)
  fb("expr_partial_access_beside_undefined", "E32 — `d.%W0`, and an undefined name in the next statement",
    "\td : DWORD := 16#12345678;\n\tout : WORD;\n\tq : INT;", "out := d.%W0;\nq := nope;"),

  // ─── E18–E21 calls ────────────────────────────────────────────────────────────────────────────────────────────────
  fb("expr_en_eno_call", "E21 — EN and ENO as a function's arguments: `F(EN := a, x := 1, y := 2, ENO => ok)`",
    "\ta : BOOL := TRUE;\n\tok : BOOL;\n\tout : INT;",
    "out := FUN_LANG_expr_en_eno_call(EN := a, x := 1, y := 2, ENO => ok);",
    adder("expr_en_eno_call")),
  fb("expr_call_positional_after_formal", "E19 — a positional argument after a formal one: `F(x := a, b)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := FUN_LANG_expr_call_positional_after_formal(x := a, b);",
    adder("expr_call_positional_after_formal")),
  fb("expr_call_formal_reordered", "E18 — formal arguments out of declaration order: `F(y := b, x := a)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := FUN_LANG_expr_call_formal_reordered(y := b, x := a);",
    adder("expr_call_formal_reordered")),

  // ─── E31 the IL operator call form, for the operator WORDS (ADD…NE are operator_call_form_*) ──────────────────────
  ints("expr_operator_call_form_mod", "E31 — MOD written as a call: `MOD(a, b)`", [7, 3, 0], "MOD(a, b)"),
  bools("expr_operator_call_form_and", "E31 — AND written as a call: `AND(a, b)`", [true, true, false], "AND(a, b)"),
  bools("expr_operator_call_form_not", "E31/E10 — NOT written as a call: `NOT(a)`", [true, false, false], "NOT(a)"),
  ints("expr_operator_call_form_lower_case", "E31 — an IL operator call in lower case: `add(a, b)`", [7, 3, 0], "add(a, b)"),
  // …a binary operator WORD where an operand belongs reads its right operand after it (`MOD(a, b)` above): a sign too?
  ints("expr_operator_word_before_minus", "E31 — an operator word before a sign: `AND -a`", [5, 0, 0], "AND -a"),
  ints("expr_operator_word_before_plus", "E31 — an operator word before a sign: `MOD +a`", [5, 0, 0], "MOD +a"),

  // ─── the CASE label lookahead (2.5.1 reads a label with the expression grammar): a label that is an EXPRESSION, and a
  // missing `;` before the next arm (task 2.6.2 names the first two) ─────────────────────────────────────────────────────
  fb("stmt_case_const_expr_label", "ST8 — a constant expression as a CASE label: `2 + 1:`",
    "\ta : INT := 3;\n\tout : INT;", "CASE a OF\n1: out := 1;\n2 + 1: out := 2;\nEND_CASE"),
  fb("stmt_case_paren_label", "ST8 — a parenthesized CASE label: `(2):`",
    "\ta : INT := 2;\n\tout : INT;", "CASE a OF\n1: out := 1;\n(2): out := 2;\nEND_CASE"),
  fb("stmt_case_nonconst_label", "ST8 — a non-constant expression as a CASE label: `a + 1:`",
    "\ta : INT := 3;\n\tout : INT;", "CASE a OF\n1: out := 1;\na + 1: out := 2;\nEND_CASE"),
  fb("stmt_case_arm_missing_semicolon", "ST8/ST13 — a missing `;` before the next CASE arm",
    "\ta : INT := 2;\n\tout : INT;", "CASE a OF\n1: out := 2\n2: out := 3;\nEND_CASE"),

  // ─── E24 parentheses: a grouping against the precedence, nested, and empty ────────────────────────────────────────
  // (a + b) * c = 20; a + b * c = 14
  ints("expr_paren_overrides_precedence", "E24 — parentheses against the precedence: `(a + b) * c`", [2, 3, 4], "(a + b) * c"),
  ints("expr_paren_nested", "E24 — parentheses twice: `((a + b)) * c`", [2, 3, 4], "((a + b)) * c"),
  fb("expr_paren_empty", "E24 — empty parentheses: `()`", "\tout : INT;", "out := ();"),

  // ─── E25 an inline assignment `(x := v)`: its value, nested ───────────────────────────────────────────────────────
  // a := 4, out := 8
  fb("expr_inline_assign_value", "E25 — an inline assignment's value in an operand: `(a := b + 1) * 2`",
    "\ta : INT;\n\tb : INT := 3;\n\tout : INT;", "out := (a := b + INT#1) * INT#2;"),
  fb("expr_inline_assign_nested", "E25 — an inline assignment inside an inline assignment: `(a := (b := 3))`",
    "\ta : INT;\n\tb : INT;\n\tout : INT;", "out := (a := (b := INT#3));"),

  // ─── E26 an inline assignment WITHOUT parentheses as a statement's condition (or selector) ─────────────────────────
  fb("expr_inline_assign_if_condition", "E26 — an inline assignment as an IF condition: `IF x := b THEN`",
    "\tx : BOOL;\n\tb : BOOL := TRUE;\n\tout : INT;", "IF x := b THEN\n\tout := 1;\nEND_IF"),
  fb("expr_inline_assign_elsif_condition", "E26 — an inline assignment as an ELSIF condition: `ELSIF x := b THEN`",
    "\tx : BOOL;\n\tb : BOOL := TRUE;\n\tn : INT;\n\tout : INT;", "IF n > INT#5 THEN\n\tout := 1;\nELSIF x := b THEN\n\tout := 2;\nEND_IF"),
  // three passes: out = 3, ok FALSE
  fb("expr_inline_assign_while_condition", "E26 — an inline assignment as a WHILE condition: `WHILE ok := (n < 3) DO`",
    "\tok : BOOL;\n\tn : INT;\n\tout : INT;", "WHILE ok := (n < INT#3) DO\n\tn := n + INT#1;\nEND_WHILE\nout := n;"),
  fb("expr_inline_assign_repeat_condition", "E26 — an inline assignment as a REPEAT condition: `UNTIL done := (n >= 3)`",
    "\tdone : BOOL;\n\tn : INT;\n\tout : INT;", "REPEAT\n\tn := n + INT#1;\nUNTIL done := (n >= INT#3)\nEND_REPEAT\nout := n;"),
  fb("expr_inline_assign_case_selector", "E26 — an inline assignment as a CASE selector: `CASE a := b OF`",
    "\ta : INT;\n\tb : INT := 2;\n\tout : INT;", "CASE a := b OF\n2: out := 1;\nEND_CASE"),
  // …and as a FOR loop's bound (the one statement expression left)
  fb("expr_inline_assign_for_bound", "E26 — an inline assignment as a FOR bound: `FOR i := 1 TO m := 3 DO`",
    "\ti : INT;\n\tm : INT;\n\tout : INT;", "FOR i := INT#1 TO m := INT#3 DO\n\tout := out + i;\nEND_FOR"),
  // …and as its start value, after the control variable's own `:=`
  fb("expr_inline_assign_for_start", "E26 — an inline assignment as a FOR start value: `FOR i := m := 1 TO 3 DO`",
    "\ti : INT;\n\tm : INT;\n\tout : INT;", "FOR i := m := INT#1 TO INT#3 DO\n\tout := out + i;\nEND_FOR"),
  // …and as an index, where no statement holds it (is `:=` an operator of every expression, or of a condition's?)
  fb("expr_inline_assign_index", "E26 — an inline assignment as an index: `arr[i := 2]`",
    "\tarr : ARRAY[1..3] OF INT := [4, 5, 6];\n\ti : INT;\n\tout : INT;", "out := arr[i := INT#2];"),
  // …and unparenthesised after a binary operator (the statement's own `:=` stands before it)
  {
    ...fb("expr_inline_assign_operand", "E26 — an inline assignment as a binary operator's right operand: `1 + a := 2`",
      "\ta : INT;\n\tout : INT;", "out := 1 + a := 2;"),
    deferred: {
      lsp: "both vendors \"'(INT#1 + a)' is no valid assignment target\": the statement is a CHAIN whose inner target `1 + a` is no name, which the LSP does not ask — the assignment forms' rule (ST4, task 2.6.1); niche: accepted loss (0 occurrences in the corpora) (2026-10-02)",
    },
  },

  // ─── E27 THIS and SUPER: with and without the `^`, where there is no base, outside a function block ───────────────
  fb("expr_this_deref_member_in_body", "E27 — `THIS^.v` in a function block's own body", "\tv : INT := 4;\n\tout : INT;",
    "out := THIS^.v;"),
  fb("expr_this_member_without_deref", "E27 — THIS without its `^`: `THIS.v`", "\tv : INT := 4;\n\tout : INT;", "out := THIS.v;"),
  fb("expr_this_as_pointer", "E27 — THIS as a pointer value: `p := THIS`",
    "\tp : POINTER TO FB_LANG_expr_this_as_pointer;\n\tv : INT := 4;\n\tout : INT;", "p := THIS;\nout := p^.v;"),
  fbSource("expr_super_without_deref", "E27 — SUPER without its `^`: `SUPER.Get()`",
    "FUNCTION_BLOCK FB_LANG_expr_super_without_deref_base\nEND_FUNCTION_BLOCK\n\nMETHOD Get : INT\nGet := 4;\nEND_METHOD\n\n" +
      "FUNCTION_BLOCK FB_LANG_expr_super_without_deref EXTENDS FB_LANG_expr_super_without_deref_base\nVAR\n\tout : INT;\nEND_VAR\nout := SUPER.Get();\nEND_FUNCTION_BLOCK\n"),
  fbSource("expr_super_deref_call", "E27 — `SUPER^.Get()` from the derived function block's body",
    "FUNCTION_BLOCK FB_LANG_expr_super_deref_call_base\nEND_FUNCTION_BLOCK\n\nMETHOD Get : INT\nGet := 4;\nEND_METHOD\n\n" +
      "FUNCTION_BLOCK FB_LANG_expr_super_deref_call EXTENDS FB_LANG_expr_super_deref_call_base\nVAR\n\tout : INT;\nEND_VAR\nout := SUPER^.Get();\nEND_FUNCTION_BLOCK\n"),
  fb("expr_super_without_base", "E27 — `SUPER^` in a function block that extends nothing", "\tout : INT;",
    "out := SUPER^.Get();"),
  fb("expr_super_without_deref_without_base", "E27 — `SUPER.Get()` (no `^`) in a function block that extends nothing",
    "\tout : INT;", "out := SUPER.Get();"),
  fb("expr_this_in_function", "E27 — `THIS^` in a FUNCTION", "\tout : INT;", "out := FUN_LANG_expr_this_in_function();",
    "FUNCTION FUN_LANG_expr_this_in_function : INT\nVAR\n\tv : INT := 4;\nEND_VAR\nFUN_LANG_expr_this_in_function := THIS^.v;\nEND_FUNCTION\n\n"),

  // ─── E33 the global-namespace operator: a leading `.` ─────────────────────────────────────────────────────────────
  withGlobals("expr_global_namespace_dot", "E33 — a leading dot names the global: `.gDot`", "\tgDot : INT;",
    "\tout : INT;", "out := .gDot;"),
  // out = 0 (the global), not 3 (the local)
  withGlobals("expr_global_namespace_shadowed_local", "E33 — `.gShadow` past a local of the same name",
    "\tgShadow : INT;", "\tgShadow : INT := 3;\n\tout : INT;", "out := .gShadow;"),
  withGlobals("expr_global_namespace_assign_target", "E33 — a leading dot as a statement's assignment target: `.gTarget := 5;`",
    "\tgTarget : INT;", "\tgTarget : INT := 3;\n\tout : INT;", ".gTarget := 5;\nout := .gTarget + gTarget;"),
  withGlobals("expr_global_namespace_member", "E33 — a member after a leading dot: `.gBox.v`",
    "\tgBox : DUT_LANG_expr_global_namespace_member;", "\tout : INT;", "out := .gBox.v;", box("expr_global_namespace_member")),
  fb("expr_global_namespace_undefined", "E33 — a leading dot before a name nothing declares: `.nope`", "\tout : INT;",
    "out := .nope;"),
  fb("expr_global_namespace_local_only", "E33 — a leading dot before a name only a local declares: `.loc`",
    "\tloc : INT := 3;\n\tout : INT;", "out := .loc;"),
  fb("expr_global_namespace_function_call", "E33 — a leading dot before a FUNCTION's call: `.F(a, b)`",
    "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := .FUN_LANG_expr_global_namespace_function_call(a, b);",
    adder("expr_global_namespace_function_call")),
  withGlobals("expr_global_namespace_space", "E33 — a leading dot apart from its name: `. gSpace`", "\tgSpace : INT;",
    "\tout : INT;", "out := . gSpace;"),
  // …as a constant global the statement writes, a global two lists declare, one called, one in a constant's initializer
  withConstGlobals("expr_global_namespace_constant_target", "E33 — a CONSTANT global written through a leading dot: `.gcTarget := 5;`",
    "\tgcTarget : INT := 7;", "\tout : INT;", ".gcTarget := 5;\nout := .gcTarget;"),
  // …two lists are two OBJECTS only with a unit between them: back to back, two VAR_GLOBAL blocks are one list's sections
  twoLists("expr_global_namespace_ambiguous", "E33 — a leading dot before a global two lists declare: `.gAmb`", "out := .gAmb;"),
  twoLists("expr_global_namespace_ambiguous_bare", "E33 — the bare name of a global two lists declare: `gAmb`", "out := gAmb;"),
  withGlobals("expr_global_namespace_call_non_callable", "E33 — a leading dot before a variable called: `.gCall(1)`",
    "\tgCall : INT;", "\tout : INT;", "out := .gCall(1);"),
  withGlobals("expr_global_namespace_variable_in_constant", "E33 — a leading dot before a variable in a CONSTANT's initializer",
    "\tgInit : INT;", "\tout : INT;\nEND_VAR\nVAR CONSTANT\n\tk : INT := .gInit;", "out := k;"),
  // …and in a DECLARATION: the corpora's only form (26), an array bound written `1...X` — `..` then `.X`
  // out = 6 — the array holds its three values, the third read (UPPER_BOUND is no probe: TwinCAT refuses it on a fixed array)
  withConstGlobals("expr_global_namespace_array_bound", "E33 — an array bound through the global namespace: `ARRAY[1...gnBound]`",
    "\tgnBound : INT := 3;", "\ta : ARRAY[1...gnBound] OF INT := [4, 5, 6];\n\tout : INT;", "out := a[3];"),
  withConstGlobals("expr_global_namespace_array_bound_index", "E33 — an index past an array bound written `1...gnIndex`: `a[4]`",
    "\tgnIndex : INT := 3;", "\ta : ARRAY[1...gnIndex] OF INT;\n\tout : INT;", "out := a[4];"),
  // out = 6
  withConstGlobals("expr_global_namespace_qualified_bound", "E33 — an array bound through a list: `ARRAY[1...GVL.gqBound]`",
    "\tgqBound : INT := 3;",
    "\ta : ARRAY[1...GVL_LANG_expr_global_namespace_qualified_bound.gqBound] OF INT := [4, 5, 6];\n\tout : INT;",
    "out := a[3];"),
  // out = 6
  fb("expr_global_namespace_enum_bound", "E33 — enum bounds `ARRAY[E.Up...E.Left]` (pro2193's `CassetteDefinition`)",
    "\ta : ARRAY[E_LANG_expr_global_namespace_enum_bound.Up...E_LANG_expr_global_namespace_enum_bound.Left] OF INT := [4, 5, 6];\n\tout : INT;",
    "out := a[2];",
    "TYPE E_LANG_expr_global_namespace_enum_bound :\n(\n\tUp := 0,\n\tDown := 1,\n\tLeft := 2\n);\nEND_TYPE\n\n"),

  // ─── E34 the pool qualifier `__POOL.` ─────────────────────────────────────────────────────────────────────────────
  // …each fixture's objects live in the APPLICATION, not the POUs view the qualifier names
  {
    ...fb("expr_pool_qualified_call", "E34 — `__POOL.F(a, b)`: a FUNCTION of the application through the pool qualifier",
      "\ta : INT := 1;\n\tb : INT := 2;\n\tout : INT;", "out := __POOL.FUN_LANG_expr_pool_qualified_call(a, b);",
      adder("expr_pool_qualified_call")),
    deferred: {
      lsp: "both vendors \"Identifier 'FUN_LANG_expr_pool_qualified_call' not defined\": `__POOL.X` looks in the POUs view only, which the workspace does not model; niche: accepted loss (0 occurrences of `__POOL` in the corpora) (2026-10-02)",
    },
  },
  {
    ...withGlobals("expr_pool_qualified_global", "E34 — `__POOL.gPool`: a global variable through the pool qualifier",
      "\tgPool : INT := 7;", "\tout : INT;", "out := __POOL.gPool;"),
    deferred: {
      lsp: "both vendors \"Identifier 'gPool' not defined\": `__POOL.X` looks in the POUs view only, which the workspace does not model; niche: accepted loss (0 occurrences of `__POOL` in the corpora) (2026-10-02)",
    },
  },
  fb("expr_pool_qualified_fb_type", "E34 — `__POOL.FB` as a declared type: `inner : __POOL.FB_x;`",
    "\tinner : __POOL.FB_LANG_expr_pool_qualified_fb_type_inner;\n\tout : INT;", "inner();\nout := inner.q;",
    "FUNCTION_BLOCK FB_LANG_expr_pool_qualified_fb_type_inner\nVAR_OUTPUT\n\tq : INT := 4;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
]
