/**
 * THE STATEMENTS, RULE BY RULE — design.md §4 2.6 of openspec `frontend-conformance` (ST1–ST19; tasks 2.6.1–2.6.3), each
 * rule put to the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words,
 * `record:exec` for what a statement DOES where that separates its readings (every fixture below that builds leaves its
 * answer in `out`, a variable of the FB, so the run recording holds `inst_<name>.out`). Rows already decided by a
 * recorded fixture elsewhere keep those fixtures (`semantics/statement-edges.ts` holds the loops' and the CASE's values,
 * `semantics/try-catch.ts` the exception blocks'); what is here is the cells that separate a rule's readings — a form
 * the grammar may or may not take (`x S=y`, `INT#1:`, `RETURN` without its `;`), and what the vendor says when it does
 * not.
 *
 * NO VARIABLE IS NAMED `s`, `r`, `st`, `cal` or `ini` (IL operators and deprecated keywords, reserved words), an
 * arithmetic operand beside a variable is TYPED (`out + INT#1`: an untyped literal's type is area 4's question, and the
 * front-end census would count the operation UNKNOWN), and ONE QUESTION PER FIXTURE, as in `expressions.ts`: the IDE
 * stops after a few parse errors, so a fixture holding two refusals measures the stop, not the rule.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.6 (statements)"

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

/** BOOL `x` holding `vx`, BOOL `y` holding `vy`, and `out : BOOL`. */
const xy = (vx: boolean, vy: boolean): string =>
  `\tx : BOOL := ${vx ? "TRUE" : "FALSE"};\n\ty : BOOL := ${vy ? "TRUE" : "FALSE"};\n\tout : BOOL;`

/** An INT selector `a` holding `va` and `out : INT`. */
const sel = (va: number): string => `\ta : INT := ${va};\n\tout : INT;`

/** A STRUCT `DUT_LANG_<name>` with one field `v : INT`, written ahead of the FB. */
function box(name: string): string {
  return `TYPE DUT_LANG_${name} :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n`
}

/** A FUNCTION `FUN_LANG_<name> : INT` with inputs `x`, `y` returning `x * INT#10 + y`, written ahead of the FB. */
function adder(name: string): string {
  return `FUNCTION FUN_LANG_${name} : INT\nVAR_INPUT\n\tx : INT;\n\ty : INT;\nEND_VAR\nFUN_LANG_${name} := x * INT#10 + y;\nEND_FUNCTION\n\n`
}

/** A FUNCTION_BLOCK `FB_LANG_<name>_target` with an input `k` and an output `q := k + 1` per call, written ahead. */
function target(name: string): string {
  return `FUNCTION_BLOCK FB_LANG_${name}_target\nVAR_INPUT\n\tk : INT;\nEND_VAR\nVAR_OUTPUT\n\tq : INT;\nEND_VAR\nq := q + k + INT#1;\nEND_FUNCTION_BLOCK\n\n`
}

/** Why a `__TRY` without `__CATCH` has no value to record. */
const TRY_WITHOUT_CATCH_DOES_NOT_START =
  "NOTHING TO MEASURE — recorded alone, twice each, as \"Login failed...\" (CODESYS 2026-10-02): a `__TRY` with no `__CATCH` builds and the application does not start; its one question is what the build says (TwinCAT refuses it)"

/** The exception code a `__CATCH` stores into. */
const EC = "\tec : __SYSTEM.ExceptionCode;\n\tec2 : __SYSTEM.ExceptionCode;\n\tzero : INT;\n\tout : INT;"

export const STATEMENT_RULE_TESTS: readonly LanguageTest[] = [
  // ─── ST1 the assignment `:=`: what may stand left of it, and what right ─────────────────────────────────────────────
  fb("stmt_assign_literal_target", "ST1 — a literal as an assignment target: `1 := a;`", sel(2), "1 := a;"),
  fb("stmt_assign_paren_target", "ST1 — a parenthesized name as an assignment target: `(out) := a;`", sel(2), "(out) := a;"),
  fb("stmt_assign_missing_value", "ST1 — an assignment without its value: `out := ;`", sel(2), "out := ;"),
  fb("stmt_assign_spaced_operator", "ST1 — the assignment operator written apart: `out : = a;`", sel(2), "out : = a;"),

  // ─── ST2 `S=` / `R=`: spelling, and what it does with a FALSE operand ──────────────────────────────────────────────
  // x is set: out = TRUE
  fb("stmt_s_eq_no_space", "ST2 — `S=` written without spaces: `x S=y;`", xy(false, true), "x S=y;\nout := x;"),
  // x is reset: out = FALSE
  fb("stmt_r_eq_no_space", "ST2 — `R=` written without spaces: `x R=y;`", xy(true, true), "x R=y;\nout := x;"),
  fb("stmt_s_eq_lower_case", "ST2 — `S=` in lower case: `x s= y;`", xy(false, true), "x s= y;\nout := x;"),
  fb("stmt_s_eq_spaced", "ST2 — `S =` written apart: `x S = y;`", xy(false, true), "x S = y;\nout := x;"),
  // S= with a FALSE operand leaves x: out = TRUE (an assignment would make it FALSE)
  fb("stmt_s_eq_false_keeps", "ST2 — `x S= y` with y FALSE leaves x as it was", xy(true, false), "x S= y;\nout := x;"),
  // R= with a FALSE operand leaves x: out = TRUE
  fb("stmt_r_eq_false_keeps", "ST2 — `x R= y` with y FALSE leaves x as it was", xy(true, false), "x R= y;\nout := x;"),
  fb("stmt_s_eq_non_bool_target", "ST2 — `S=` on an INT target: `n S= y;`", "\tn : INT;\n\ty : BOOL := TRUE;\n\tout : INT;",
    "n S= y;\nout := n;"),
  fb("stmt_s_eq_non_bool_value", "ST2 — `S=` with an INT operand: `x S= n;`", "\tx : BOOL;\n\tn : INT := 1;\n\tout : BOOL;",
    "x S= n;\nout := x;"),

  // ─── ST3 `REF=`: on a non-reference, spelling, a literal operand ───────────────────────────────────────────────────
  fb("stmt_ref_eq_on_non_reference", "ST3 — `REF=` onto a variable that is no reference: `n REF= m;`",
    "\tn : INT;\n\tm : INT := 5;\n\tout : INT;", "n REF= m;\nout := n;"),
  // rn refers to m: out = 7
  fb("stmt_ref_eq_no_space", "ST3 — `REF=` written without spaces: `rn REF=m;`",
    "\trn : REFERENCE TO INT;\n\tm : INT := 5;\n\tout : INT;", "rn REF=m;\nm := INT#7;\nout := rn;"),
  fb("stmt_ref_eq_lower_case", "ST3 — `REF=` in lower case: `rn ref= m;`",
    "\trn : REFERENCE TO INT;\n\tm : INT := 5;\n\tout : INT;", "rn ref= m;\nout := rn;"),
  fb("stmt_ref_eq_spaced", "ST3 — `REF =` written apart: `rn REF = m;`",
    "\trn : REFERENCE TO INT;\n\tm : INT := 5;\n\tout : INT;", "rn REF = m;\nout := rn;"),
  fb("stmt_ref_eq_literal_value", "ST3 — `REF=` onto a literal: `rn REF= 5;`",
    "\trn : REFERENCE TO INT;\n\tout : INT;", "rn REF= 5;\nout := rn;"),

  // ─── ST4 chains with mixed operators, and a chain's inner target ──────────────────────────────────────────────────
  // z S= y sets z; x := (that) — out = TRUE if the chain passes z on
  fb("stmt_chain_assign_then_set", "ST4 — a chain `x := z S= y;`",
    "\tx : BOOL;\n\tz : BOOL;\n\ty : BOOL := TRUE;\n\tout : BOOL;", "x := z S= y;\nout := x;"),
  // x S= (z := y): out = TRUE
  fb("stmt_chain_set_then_assign", "ST4 — a chain `x S= z := y;`",
    "\tx : BOOL;\n\tz : BOOL;\n\ty : BOOL := TRUE;\n\tout : BOOL;", "x S= z := y;\nout := x;"),
  fb("stmt_chain_literal_inner_target", "ST4 — a chain whose inner target is a literal: `out := 1 := a;`", sel(2),
    "out := 1 := a;"),
  fb("stmt_chain_three_targets", "ST4 — a chain of three plain targets: `out := b := c := a;` (out = 2)",
    "\ta : INT := 2;\n\tb : INT;\n\tc : INT;\n\tout : INT;", "out := b := c := a;"),
  // a SIGN on the inner target: an operation too, or the name under it?
  fb("stmt_chain_negated_inner_target", "ST4 — a chain whose inner target is a negation: `out := -a := 2;`", sel(2),
    "out := -a := 2;"),

  // ─── ST5 a call statement; a bare expression as a statement ───────────────────────────────────────────────────────
  fb("stmt_bare_comparison", "ST5 — a comparison as a statement (the `=` for `:=` typo): `out = a;`", sel(2), "out = a;"),
  fb("stmt_bare_binary", "ST5 — an arithmetic expression as a statement: `a + 1;`", sel(2), "a + 1;"),
  fb("stmt_bare_literal", "ST5 — a literal as a statement: `5;`", sel(2), "5;"),
  fb("stmt_bare_paren_name", "ST5 — a parenthesized name as a statement: `(a);`", sel(2), "(a);"),
  fb("stmt_bare_not", "ST5 — a NOT as a statement: `NOT x;`", xy(true, false), "NOT x;"),
  fb("stmt_bare_negation", "ST5 — a negation as a statement: `-a;`", sel(2), "-a;"),
  fb("stmt_bare_true", "ST5 — TRUE as a statement: `TRUE;`", sel(2), "TRUE;"),
  fb("stmt_bare_member", "ST5 — a member read as a statement: `bx.v;`", "\tbx : DUT_LANG_stmt_bare_member;\n\tout : INT;",
    "bx.v;", box("stmt_bare_member")),
  fb("stmt_function_call_discarded", "ST5 — a FUNCTION called as a statement, its result dropped: `F(1, 2);`", sel(2),
    "FUN_LANG_stmt_function_call_discarded(1, 2);", adder("stmt_function_call_discarded")),
  fb("stmt_limit_call_statement", "ST5 — a standard operator called as a statement, its result dropped: `LIMIT(0, a, 5);`", sel(2),
    "LIMIT(0, a, 5);"),
  fb("stmt_bare_function_name", "ST5 — a FUNCTION's name alone as a statement: `F;`", sel(2), "FUN_LANG_stmt_bare_function_name;",
    adder("stmt_bare_function_name")),
  // …and inside the FUNCTION itself, where the name is also its return variable (out = 12)
  fb("stmt_function_own_name_bare", "ST5 — a FUNCTION's name alone as a statement INSIDE that FUNCTION, where it is the return variable: `F;`",
    "\tout : INT;", "out := FUN_LANG_stmt_function_own_name_bare(1, 2);",
    `FUNCTION FUN_LANG_stmt_function_own_name_bare : INT\nVAR_INPUT\n\tx : INT;\n\ty : INT;\nEND_VAR\nFUN_LANG_stmt_function_own_name_bare := x * INT#10 + y;\nFUN_LANG_stmt_function_own_name_bare;\nEND_FUNCTION\n\n`),

  // ─── ST6 IF: an empty branch, ELSIF after ELSE, two ELSEs, `ELSE IF` written as two words ─────────────────────────
  // out = 1: the empty IF runs nothing and the statement after it runs
  fb("stmt_if_empty_then", "ST6 — an IF whose THEN branch is empty", "\tx : BOOL := TRUE;\n\tout : INT;", "IF x THEN\nEND_IF\nout := 1;"),
  fb("stmt_if_elsif_after_else", "ST6 — an ELSIF after the ELSE", "\tx : BOOL;\n\ty : BOOL;\n\tout : INT;",
    "IF x THEN\n\tout := 1;\nELSE\n\tout := 2;\nELSIF y THEN\n\tout := 3;\nEND_IF"),
  fb("stmt_if_two_else", "ST6 — an IF with two ELSE branches", "\tx : BOOL;\n\tout : INT;",
    "IF x THEN\n\tout := 1;\nELSE\n\tout := 2;\nELSE\n\tout := 3;\nEND_IF"),
  fb("stmt_if_else_if_two_words", "ST6 — `ELSE IF` written as two words with ONE END_IF (no ELSIF)",
    "\tx : BOOL;\n\ty : BOOL;\n\tout : INT;", "IF x THEN\n\tout := 1;\nELSE IF y THEN\n\tout := 2;\nEND_IF"),
  // out = 3: `ELSE IF … END_IF END_IF` is an IF nested in the ELSE
  fb("stmt_if_else_if_nested", "ST6 — `ELSE IF … END_IF END_IF`: an IF nested in the ELSE",
    "\tx : BOOL;\n\ty : BOOL;\n\tout : INT;", "IF x THEN\n\tout := 1;\nELSE IF y THEN\n\tout := 2;\nELSE\n\tout := 3;\nEND_IF\nEND_IF"),
  fb("stmt_if_empty_statement_body", "ST6/ST16 — an IF whose branch is one empty statement: `IF x THEN ; END_IF`",
    "\tx : BOOL := TRUE;\n\tout : INT;", "IF x THEN\n\t;\nEND_IF\nout := 1;"),

  // ─── ST7 CASE: no arms, ELSE only, a duplicate label, an overlap, a reversed range, a trailing comma ──────────────
  fb("stmt_case_no_arms", "ST7 — a CASE with no arm: `CASE a OF END_CASE`", sel(2), "CASE a OF\nEND_CASE\nout := 1;"),
  // out = 2
  fb("stmt_case_else_only", "ST7 — a CASE with only an ELSE", sel(2), "CASE a OF\nELSE\n\tout := 2;\nEND_CASE"),
  fb("stmt_case_duplicate_label", "ST7 — the same label on two arms", sel(1), "CASE a OF\n1: out := 1;\n1: out := 2;\nEND_CASE"),
  fb("stmt_case_overlapping_range", "ST7 — a label inside an earlier arm's range", sel(2),
    "CASE a OF\n1..3: out := 1;\n2: out := 2;\nEND_CASE"),
  // a = 2 inside 3..1 read either way? out = 1 when the range is taken, 0 when it is empty
  fb("stmt_case_reversed_range", "ST7 — a reversed range `3..1:`", sel(2), "CASE a OF\n3..1: out := 1;\nEND_CASE"),
  fb("stmt_case_label_trailing_comma", "ST7 — a label list with a trailing comma: `1, 2,:`", sel(2),
    "CASE a OF\n1, 2,: out := 1;\nEND_CASE"),

  // ─── ST8 CASE: a negative label, a negative range, a `+` label ─────────────────────────────────────────────────────
  // out = 1
  fb("stmt_case_negative_label", "ST8 — a negative CASE label: `-1:`", sel(-1), "CASE a OF\n-1: out := 1;\n1: out := 2;\nEND_CASE"),
  // out = 1
  fb("stmt_case_negative_range", "ST8 — a negative range: `-3..-1:`", sel(-2), "CASE a OF\n-3..-1: out := 1;\n1: out := 2;\nEND_CASE"),
  // out = 2
  fb("stmt_case_plus_label", "ST8 — a signed positive label: `+1:`", sel(1), "CASE a OF\n-1: out := 1;\n+1: out := 2;\nEND_CASE"),

  // ─── ST9 CASE: a typed literal, a constant's name, a parenthesized label, a constant expression ────────────────────
  // out = 2
  fb("stmt_case_typed_label", "ST9 — typed-literal CASE labels: `INT#1:`, `INT#2:`", sel(2),
    "CASE a OF\nINT#1: out := 1;\nINT#2: out := 2;\nEND_CASE"),
  fb("stmt_case_typed_label_other_type", "ST9 — a typed-literal label of another type than the selector: `DINT#2:` on an INT",
    sel(2), "CASE a OF\nINT#1: out := 1;\nDINT#2: out := 2;\nEND_CASE"),
  // out = 2: a narrower typed label on a DINT selector
  fb("stmt_case_typed_label_narrower", "ST9 — a typed-literal label narrower than the selector: `INT#2:` on a DINT",
    "\ta : DINT := 2;\n\tout : INT;", "CASE a OF\nINT#1: out := 1;\nINT#2: out := 2;\nEND_CASE"),
  // out = 2
  fb("stmt_case_const_name_label", "ST9 — a constant's name as a CASE label: `k:` (VAR CONSTANT)",
    `${sel(2)}\nEND_VAR\nVAR CONSTANT\n\tk : INT := 2;`, "CASE a OF\n1: out := 1;\nk: out := 2;\nEND_CASE"),
  fb("stmt_case_variable_label", "ST9 — a VARIABLE's name as a CASE label: `m:`", `${sel(2)}\n\tm : INT := 2;`,
    "CASE a OF\n1: out := 1;\nm: out := 2;\nEND_CASE"),
  fb("stmt_case_const_expr_label", "ST9 — a constant expression as a CASE label: `2 + 1:`", sel(3),
    "CASE a OF\n1: out := 1;\n2 + 1: out := 2;\nEND_CASE"),
  fb("stmt_case_paren_label", "ST9 — a parenthesized CASE label: `(2):`", sel(2), "CASE a OF\n1: out := 1;\n(2): out := 2;\nEND_CASE"),
  fb("stmt_case_nonconst_label", "ST9 — a non-constant expression as a CASE label: `a + 1:`", sel(3),
    "CASE a OF\n1: out := 1;\na + 1: out := 2;\nEND_CASE"),
  fb("stmt_case_arm_missing_semicolon", "ST9/ST14 — a missing `;` before the next CASE arm", sel(2),
    "CASE a OF\n1: out := 2\n2: out := 3;\nEND_CASE"),

  // ─── ST10 CASE: an empty arm, before another arm, last, before ELSE ────────────────────────────────────────────────
  fb("stmt_case_empty_arm", "ST10 — an empty CASE arm before another arm: `1:` then `2: …`", sel(2),
    "CASE a OF\n1:\n2: out := 2;\nEND_CASE"),
  fb("stmt_case_empty_arm_last", "ST10 — an empty CASE arm last: `2:` then END_CASE", sel(2),
    "CASE a OF\n1: out := 1;\n2:\nEND_CASE"),
  fb("stmt_case_empty_arm_before_else", "ST10 — an empty CASE arm before ELSE", sel(2),
    "CASE a OF\n1: out := 1;\n2:\nELSE\n\tout := 3;\nEND_CASE"),

  // ─── ST11 FOR: a member as the control variable, an empty body, a REAL and a literal control variable ─────────────
  // out = 3 (three passes) if a member may count
  fb("stmt_for_member_control", "ST11 — a STRUCT member as the FOR control variable: `FOR bx.v := 1 TO 3 DO`",
    "\tbx : DUT_LANG_stmt_for_member_control;\n\tout : INT;", "FOR bx.v := 1 TO 3 DO\n\tout := out + INT#1;\nEND_FOR",
    box("stmt_for_member_control")),
  // out = 4: the variable after the loop
  fb("stmt_for_empty_body", "ST11 — a FOR with an empty body", "\ti : INT;\n\tout : INT;", "FOR i := 1 TO 3 DO\nEND_FOR\nout := i;"),
  fb("stmt_for_real_control", "ST11 — a REAL as the FOR control variable", "\trv : REAL;\n\tout : INT;",
    "FOR rv := 1.0 TO 3.0 DO\n\tout := out + INT#1;\nEND_FOR"),
  fb("stmt_for_bool_control", "ST11 — a BOOL as the FOR control variable", "\tbv : BOOL;\n\tout : INT;",
    "FOR bv := 0 TO 1 DO\n\tout := out + INT#1;\nEND_FOR"),
  // out = 3 if a DWORD may count
  fb("stmt_for_dword_control", "ST11 — a DWORD as the FOR control variable", "\tdw : DWORD;\n\tout : INT;",
    "FOR dw := 1 TO 3 DO\n\tout := out + INT#1;\nEND_FOR"),
  fb("stmt_for_literal_control", "ST11 — a literal as the FOR control variable: `FOR 1 := 1 TO 3 DO`", "\tout : INT;",
    "FOR 1 := 1 TO 3 DO\n\tout := out + 1;\nEND_FOR"),
  fb("stmt_for_negated_control", "ST11 — a negation as the FOR control variable: `FOR -i := 1 TO 3 DO`", "\ti : INT;\n\tout : INT;",
    "FOR -i := 1 TO 3 DO\n\tout := i;\nEND_FOR"),

  // ─── ST12 WHILE / REPEAT: an empty body, a `;` after UNTIL's condition ────────────────────────────────────────────
  // out = 1
  fb("stmt_while_empty_body", "ST12 — a WHILE with an empty body", "\tx : BOOL;\n\tout : INT;", "WHILE x DO\nEND_WHILE\nout := 1;"),
  // out = 1
  fb("stmt_repeat_empty_body", "ST12 — a REPEAT with an empty body", "\ty : BOOL := TRUE;\n\tout : INT;",
    "REPEAT\nUNTIL y\nEND_REPEAT\nout := 1;"),
  // out = 3
  fb("stmt_repeat_until_semicolon", "ST12 — a `;` after UNTIL's condition: `UNTIL n >= 3; END_REPEAT`",
    "\tn : INT;\n\tout : INT;", "REPEAT\n\tn := n + INT#1;\nUNTIL n >= INT#3;\nEND_REPEAT\nout := n;"),

  // ─── ST13 EXIT / CONTINUE outside a loop ──────────────────────────────────────────────────────────────────────────
  fb("stmt_exit_outside_loop", "ST13 — EXIT outside a loop", "\tout : INT;", "out := 1;\nEXIT;\nout := 2;"),
  fb("stmt_continue_outside_loop", "ST13 — CONTINUE outside a loop", "\tout : INT;", "out := 1;\nCONTINUE;\nout := 2;"),

  // ─── ST14 RETURN / EXIT / CONTINUE without their `;` — before a statement, and before a block's END ───────────────
  fb("stmt_return_no_semicolon", "ST14 — RETURN without its `;` before a statement", "\tout : INT;",
    "out := 1;\nRETURN\nout := 2;"),
  fb("stmt_exit_no_semicolon", "ST14 — EXIT without its `;` before a statement", "\ti : INT;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tEXIT\n\tout := i;\nEND_FOR"),
  fb("stmt_continue_no_semicolon", "ST14 — CONTINUE without its `;` before a statement", "\ti : INT;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tCONTINUE\n\tout := i;\nEND_FOR"),
  fb("stmt_assign_no_semicolon_before_end_if", "ST14/R1 — an assignment without its `;` before END_IF", "\tx : BOOL;\n\tout : INT;",
    "IF x THEN\n\tout := 1\nEND_IF"),
  fb("stmt_return_no_semicolon_before_end_if", "ST14 — RETURN without its `;` before END_IF", "\tx : BOOL;\n\tout : INT;",
    "IF x THEN\n\tRETURN\nEND_IF\nout := 1;"),
  fb("stmt_exit_no_semicolon_before_end_for", "ST14 — EXIT without its `;` before END_FOR", "\ti : INT;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tout := i;\n\tEXIT\nEND_FOR"),
  // …and an assignment without its `;` before EVERY other keyword the statement list resyncs at: the statement keywords
  // (a statement after it) and the block keywords that end or split a statement list
  fb("stmt_assign_no_semicolon_before_if", "ST14 — an assignment without its `;` before IF", "\tx : BOOL;\n\tout : INT;",
    "out := 1\nIF x THEN\n\tout := 2;\nEND_IF"),
  fb("stmt_assign_no_semicolon_before_case", "ST14 — an assignment without its `;` before CASE", sel(2),
    "out := 1\nCASE a OF\n2: out := 2;\nEND_CASE"),
  fb("stmt_assign_no_semicolon_before_for", "ST14 — an assignment without its `;` before FOR", "\ti : INT;\n\tout : INT;",
    "out := 1\nFOR i := 1 TO 3 DO\n\tout := i;\nEND_FOR"),
  fb("stmt_assign_no_semicolon_before_while", "ST14 — an assignment without its `;` before WHILE", "\tx : BOOL;\n\tout : INT;",
    "out := 1\nWHILE x DO\n\tx := FALSE;\nEND_WHILE"),
  fb("stmt_assign_no_semicolon_before_repeat", "ST14 — an assignment without its `;` before REPEAT", "\tx : BOOL := TRUE;\n\tout : INT;",
    "out := 1\nREPEAT\n\tout := 2;\nUNTIL x\nEND_REPEAT"),
  fb("stmt_assign_no_semicolon_before_return", "ST14 — an assignment without its `;` before RETURN", "\tout : INT;",
    "out := 1\nRETURN;"),
  fb("stmt_assign_no_semicolon_before_exit", "ST14 — an assignment without its `;` before EXIT", "\ti : INT;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tout := i\n\tEXIT;\nEND_FOR"),
  fb("stmt_assign_no_semicolon_before_continue", "ST14 — an assignment without its `;` before CONTINUE", "\ti : INT;\n\tout : INT;",
    "FOR i := 1 TO 3 DO\n\tout := i\n\tCONTINUE;\nEND_FOR"),
  fb("stmt_assign_no_semicolon_before_try", "ST14 — an assignment without its `;` before `__TRY`", EC,
    "out := 1\n__TRY\n\tout := 2;\n__CATCH\n\tout := 3;\n__ENDTRY"),
  fb("stmt_assign_no_semicolon_before_else", "ST14 — an assignment without its `;` before an IF's ELSE", "\tx : BOOL;\n\tout : INT;",
    "IF x THEN\n\tout := 1\nELSE\n\tout := 2;\nEND_IF"),
  fb("stmt_assign_no_semicolon_before_elsif", "ST14 — an assignment without its `;` before ELSIF", "\tx : BOOL;\n\ty : BOOL;\n\tout : INT;",
    "IF x THEN\n\tout := 1\nELSIF y THEN\n\tout := 2;\nEND_IF"),
  fb("stmt_assign_no_semicolon_before_case_else", "ST14 — an assignment without its `;` before a CASE's ELSE", sel(2),
    "CASE a OF\n1: out := 1\nELSE\n\tout := 2;\nEND_CASE"),
  fb("stmt_assign_no_semicolon_before_until", "ST14 — an assignment without its `;` before UNTIL", "\tx : BOOL := TRUE;\n\tout : INT;",
    "REPEAT\n\tout := 1\nUNTIL x\nEND_REPEAT"),
  fb("stmt_assign_no_semicolon_before_end_while", "ST14 — an assignment without its `;` before END_WHILE", "\tx : BOOL;\n\tout : INT;",
    "WHILE x DO\n\tx := FALSE\nEND_WHILE"),
  fb("stmt_assign_no_semicolon_before_catch", "ST14 — an assignment without its `;` before `__CATCH`", EC,
    "__TRY\n\tout := 1\n__CATCH\n\tout := 2;\n__ENDTRY"),
  fb("stmt_assign_no_semicolon_before_finally", "ST14 — an assignment without its `;` before `__FINALLY`", EC,
    "__TRY\n\tout := 1;\n__CATCH\n\tout := 2\n__FINALLY\n\tout := 3;\n__ENDTRY"),
  fb("stmt_assign_no_semicolon_before_endtry", "ST14 — an assignment without its `;` before `__ENDTRY`", EC,
    "__TRY\n\tout := 1;\n__CATCH\n\tout := 2\n__ENDTRY"),

  // ─── ST15 JMP without its `;`, a label with nothing after it ──────────────────────────────────────────────────────
  fb("stmt_jmp_no_semicolon", "ST15 — JMP without its `;` before a statement", "\tout : INT;",
    "JMP lbl\nout := 1;\nlbl:\nout := 2;"),
  // out = 1: the jump skips `out := 2`
  fb("stmt_label_at_end", "ST15 — a label with no statement after it, at the body's end", "\tout : INT;",
    "out := 1;\nJMP lbl;\nout := 2;\nlbl:"),

  // ─── ST18 `__TRY` without `__CATCH`; with `__FINALLY` only; nested in a `__CATCH` ─────────────────────────────────
  // CODESYS builds both, and its application then does not start (below)
  {
    ...fb("stmt_try_without_catch", "ST18 — `__TRY … __ENDTRY` with neither `__CATCH` nor `__FINALLY`", EC,
      "__TRY\n\tout := 1;\n__ENDTRY"),
    execSkip: TRY_WITHOUT_CATCH_DOES_NOT_START,
  },
  {
    ...fb("stmt_try_finally_only", "ST18 — `__TRY … __FINALLY … __ENDTRY` without `__CATCH`", EC,
      "__TRY\n\tout := 1;\n__FINALLY\n\tout := out + INT#1;\n__ENDTRY"),
    execSkip: TRY_WITHOUT_CATCH_DOES_NOT_START,
  },
  // out = 2: the inner block runs in the outer CATCH and catches nothing
  fb("stmt_try_nested", "ST18 — a `__TRY` nested in a `__CATCH`", EC,
    "__TRY\n\tout := INT#10 / zero;\n__CATCH\n\t__TRY\n\t\tout := 2;\n\t__CATCH\n\t\tout := 3;\n\t__ENDTRY\n__ENDTRY"),
  fb("stmt_try_catch_without_operand", "ST18 — `__CATCH` without its parenthesized operand", EC,
    "__TRY\n\tout := 1;\n__CATCH\n\tout := 2;\n__ENDTRY"),

  // ─── ST19 CAL and INI as statements ──────────────────────────────────────────────────────────────────────────────
  fb("stmt_cal_instance", "ST19 — `CAL t(k := 1);`, the IL call keyword with an argument", "\tt : FB_LANG_stmt_cal_instance_target;\n\tout : INT;",
    "CAL t(k := 1);\nout := t.q;", target("stmt_cal_instance")),
  fb("stmt_cal_without_parens", "ST19 — `CAL t;` without an argument list", "\tt : FB_LANG_stmt_cal_without_parens_target;\n\tout : INT;",
    "CAL t;\nout := t.q;", target("stmt_cal_without_parens")),
  // out = 0 if INI re-initialises t after its call (q back to 0), 2 if it does not
  fb("stmt_ini_call", "ST19 — `INI(t, TRUE);` as a statement", "\tt : FB_LANG_stmt_ini_call_target;\n\tout : INT;",
    "t(k := 1);\nINI(t, TRUE);\nout := t.q;", target("stmt_ini_call")),
]
