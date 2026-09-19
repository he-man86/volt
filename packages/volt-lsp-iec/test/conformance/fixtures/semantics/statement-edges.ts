/**
 * EVERY STATEMENT KIND AT ITS EDGES — the loop that runs zero times, the CASE that matches nothing, the EXIT out of
 * the inner loop, and what the loop variable holds afterwards.
 *
 * The statement kinds are all exercised somewhere (`[ir] statements 9/9`), which says each one LOWERS. It says
 * nothing about the boundaries, and the boundaries are where the answers are not obvious:
 *
 *   FOR      a range that runs ZERO times, a negative step, a bound the BODY changes, and the value the control
 *            variable is left holding — which IEC does not define and every compiler decides for itself
 *   WHILE    a condition false on entry
 *   REPEAT   the same, where the body must still run once
 *   CASE     no matching label with and without an ELSE, a range label, several labels on one arm
 *   EXIT     out of a nested loop — the inner one only, or both?
 *   CONTINUE the same question from the other side
 *   RETURN   from the middle of a body, and from inside a loop
 *
 * Each probe reads a counter, so the answer is a number: how many times the body ran, or what the variable held.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, read: string, feature: string): LanguageTest {
  // `read` of "" means the BODY writes `out` — which is the only way to ask anything about RETURN, since the
  // trailing read would be one of the statements RETURN skips.
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "09-statements.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\ti : INT;\n\tn : INT;\n${decls}\n\tout : INT;\nEND_VAR\n${body}\n${read === "" ? "" : `out := ${read};\n`}END_FUNCTION_BLOCK\n`,
  }
}

const loops: LanguageTest[] = [
  probe("stmt_for_runs", "", "n := 0;\nFOR i := 1 TO 3 DO\n\tn := n + 1;\nEND_FOR", "n", "a FOR over three values"),
  probe(
    "stmt_for_zero_times",
    "",
    "n := 0;\nFOR i := 3 TO 1 DO\n\tn := n + 1;\nEND_FOR",
    "n",
    "a FOR whose start is past its end — does the body run at all?",
  ),
  probe(
    "stmt_for_variable_after",
    "",
    "FOR i := 1 TO 3 DO\n\tn := n + 1;\nEND_FOR",
    "i",
    "what the control variable holds AFTER the loop — 3, or one past it?",
  ),
  probe(
    "stmt_for_variable_after_zero",
    "",
    "i := 99;\nFOR i := 3 TO 1 DO\n\tn := n + 1;\nEND_FOR",
    "i",
    "the control variable after a loop that ran zero times — is it assigned at all?",
  ),
  probe(
    "stmt_for_negative_step",
    "",
    "n := 0;\nFOR i := 3 TO 1 BY -1 DO\n\tn := n + 1;\nEND_FOR",
    "n",
    "a FOR counting down",
  ),
  probe(
    "stmt_for_step_two",
    "",
    "n := 0;\nFOR i := 1 TO 6 BY 2 DO\n\tn := n + 1;\nEND_FOR",
    "n",
    "a FOR stepping by two over six values",
  ),
  probe(
    "stmt_for_bound_changed",
    "\tcap : INT;",
    "cap := 3;\nn := 0;\nFOR i := 1 TO cap DO\n\tcap := 10;\n\tn := n + 1;\nEND_FOR",
    "n",
    "a FOR whose upper bound the BODY raises — is it read once or every pass? (`cap`, because LIMIT is a standard function and cannot be a variable name)",
  ),
  probe(
    "stmt_while_never",
    "",
    "n := 0;\nWHILE n > 5 DO\n\tn := n + 1;\nEND_WHILE",
    "n",
    "a WHILE whose condition is false on entry",
  ),
  probe("stmt_while_counts", "", "n := 0;\nWHILE n < 3 DO\n\tn := n + 1;\nEND_WHILE", "n", "a WHILE counting to three"),
  probe(
    "stmt_repeat_once",
    "",
    "n := 0;\nREPEAT\n\tn := n + 1;\nUNTIL n > 5\nEND_REPEAT",
    "n",
    "a REPEAT whose condition is already true — the body still runs once",
  ),
]

const jumps: LanguageTest[] = [
  probe(
    "stmt_exit_inner",
    "\tj : INT;",
    "n := 0;\nFOR i := 1 TO 3 DO\n\tFOR j := 1 TO 3 DO\n\t\tEXIT;\n\tEND_FOR\n\tn := n + 1;\nEND_FOR",
    "n",
    "EXIT from a nested loop — the inner one only, so the outer runs three times?",
  ),
  probe(
    "stmt_continue_skips",
    "",
    "n := 0;\nFOR i := 1 TO 4 DO\n\tIF i = 2 THEN\n\t\tCONTINUE;\n\tEND_IF\n\tn := n + 1;\nEND_FOR",
    "n",
    "CONTINUE skipping one pass of four",
  ),
  probe(
    "stmt_return_midway",
    "",
    "n := 1;\nout := n;\nRETURN;\nn := 99;\nout := n;",
    "",
    "RETURN in the middle of a body — the statement after it must not run",
  ),
  probe(
    "stmt_return_in_loop",
    "",
    "n := 0;\nFOR i := 1 TO 5 DO\n\tn := n + 1;\n\tout := n;\n\tIF n = 2 THEN\n\t\tRETURN;\n\tEND_IF\nEND_FOR\nn := 99;\nout := n;",
    "",
    "RETURN from inside a loop leaves the whole body",
  ),
]

const branches: LanguageTest[] = [
  probe("stmt_if_taken", "", "n := 0;\nIF n = 0 THEN\n\tn := 1;\nEND_IF", "n", "an IF with no ELSE, taken"),
  probe("stmt_if_not_taken", "", "n := 7;\nIF n = 0 THEN\n\tn := 1;\nEND_IF", "n", "an IF with no ELSE, not taken"),
  probe(
    "stmt_elsif_second",
    "",
    "n := 2;\nIF n = 1 THEN\n\tn := 10;\nELSIF n = 2 THEN\n\tn := 20;\nELSE\n\tn := 30;\nEND_IF",
    "n",
    "an ELSIF arm taken",
  ),
  probe(
    "stmt_case_matched",
    "",
    "n := 2;\nCASE n OF\n\t1: n := 10;\n\t2: n := 20;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE that matches",
  ),
  probe(
    "stmt_case_no_match_with_else",
    "",
    "n := 7;\nCASE n OF\n\t1: n := 10;\n\t2: n := 20;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE that matches nothing, with an ELSE",
  ),
  probe(
    "stmt_case_no_match_no_else",
    "",
    "n := 7;\nCASE n OF\n\t1: n := 10;\n\t2: n := 20;\nEND_CASE",
    "n",
    "a CASE that matches nothing and has no ELSE — n must be untouched",
  ),
  probe(
    "stmt_case_range",
    "",
    "n := 4;\nCASE n OF\n\t1..3: n := 10;\n\t4..6: n := 20;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE with range labels",
  ),
  probe(
    "stmt_case_multi_label",
    "",
    "n := 5;\nCASE n OF\n\t1, 3, 5: n := 10;\n\t2, 4, 6: n := 20;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE arm with several labels",
  ),
  probe(
    "stmt_case_boundary_low",
    "",
    "n := 1;\nCASE n OF\n\t1..3: n := 10;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE range at its lower edge — inclusive?",
  ),
  probe(
    "stmt_case_boundary_high",
    "",
    "n := 3;\nCASE n OF\n\t1..3: n := 10;\nELSE\n\tn := 99;\nEND_CASE",
    "n",
    "a CASE range at its upper edge",
  ),
]

export const STATEMENT_EDGE_TESTS: readonly LanguageTest[] = [...loops, ...jumps, ...branches]
