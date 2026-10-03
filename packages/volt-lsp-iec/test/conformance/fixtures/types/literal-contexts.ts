/**
 * LITERAL TYPING IN EVERY CONTEXT — design.md §4 4.2 of openspec `frontend-conformance` (LT12, LT13; task 4.2), the two
 * literal rules the recorded fixtures elsewhere reached only through narrowing assignments, put to the vendor context by
 * context: `record:language` for what the compiler says, `record:exec` for the values (each FB copies what it computes
 * into VAR outputs, so the run recording holds `inst_<name>.<var>`).
 *
 *   LT12  an untyped integer literal as a comparison operand (beside a narrower variable, beside an unsigned one), a CASE
 *         label (in range, out of the selector's range), an ARRAY bound beyond INT, FOR bounds (in range, beyond the
 *         counter's), and as an argument to an ANY_INT input — whose `diSize` is the literal's own width
 *   LT13  negative literals at each signed type's minimum (`-128` into SINT, `-32768` into INT, DINT's and LINT's), and one
 *         below it
 *
 * LT14 is `test/frontend/literal-agreement.test.ts`, over every literal of the corpus and the fixtures.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`…_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 4.2 (literal typing); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it.
 *  Instanced in PLC_PRG as `inst_<name>` and called. */
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

// ─── LT12 — an untyped literal in each context ───────────────────────────────────────────────────────────────────────

const CONTEXTS: LanguageTest[] = [
  fb("lt_literal_in_comparison", "an untyped literal beside a narrower variable: SINT = 200, SINT < 300, INT = 70000, INT > -40000",
    "\tsi : SINT := 100;\n\ti : INT := 1000;\n\tb1 : BOOL;\n\tb2 : BOOL;\n\tb3 : BOOL;\n\tb4 : BOOL;",
    "b1 := si = 200;\nb2 := si < 300;\nb3 := i = 70000;\nb4 := i > -40000;"),
  {
    ...fb("lt_literal_negative_in_comparison_unsigned", "an untyped negative literal beside an unsigned variable: USINT = -1, UINT > -1",
      "\tu : USINT := 255;\n\tui : UINT := 3;\n\tb1 : BOOL;\n\tb2 : BOOL;",
      "b1 := u = -1;\nb2 := ui > -1;"),
    deferred: {
      transpile:
        "2026-10-03, CODESYS run: `ui > -1` is FALSE (b2) — the literal converts into UDINT, 4294967295 (\"signed Type 'SINT' to unsigned Type 'UDINT'\", rule LT12) — and lowering compares the two as numbers (TRUE); the LSP's half is types/arith/operators negativeLiteralComparisonTarget, the transpiler's is transpile-restructure's (task 5.3)",
    },
  },
  fb("lt_literal_case_label", "untyped CASE labels at a SINT selector's extremes, and a range",
    "\tsi : SINT := -128;\n\tout : INT;\n\tout2 : INT;\n\tsi2 : SINT := 127;",
    "CASE si OF\n-128: out := 1;\n0..10: out := 2;\n127: out := 3;\nEND_CASE\nCASE si2 OF\n-128: out2 := 1;\n127: out2 := 3;\nEND_CASE"),
  fb("lt_literal_case_label_out_of_range", "an untyped CASE label outside a SINT selector's range: 200",
    "\tsi : SINT := 100;\n\tout : INT;",
    "CASE si OF\n100: out := 1;\n200: out := 2;\nEND_CASE"),
  fb("lt_literal_array_bound", "an untyped ARRAY bound beyond INT (40000), indexed by the same literal",
    "\ta : ARRAY[0..40000] OF BYTE;\n\tout : BYTE;",
    "a[40000] := 7;\nout := a[40000];"),
  fb("lt_literal_for_bounds", "untyped FOR bounds at a SINT counter's extremes: -128 TO 126, and BY 2",
    "\tsi : SINT;\n\tn : INT;\n\tm : INT;",
    "FOR si := -128 TO 126 DO\n\tn := n + 1;\nEND_FOR\nFOR si := 0 TO 100 BY 2 DO\n\tm := m + 1;\nEND_FOR"),
  fb("lt_literal_for_bounds_out_of_range", "an untyped FOR bound beyond a SINT counter's range: 1 TO 200",
    "\tsi : SINT;\n\tn : INT;",
    "FOR si := 1 TO 200 DO\n\tn := n + 1;\n\tIF n > 300 THEN EXIT; END_IF\nEND_FOR"),
  {
    name: "lt_literal_any_int_argument",
    pouName: "FUN_LANG_lt_literal_any_int_argument",
    kind: "function",
    feature: "an untyped literal as an ANY_INT argument — its `diSize` is the width the literal takes: 5, 300, 70000, 5000000000, -1, -200",
    fromDoc: doc,
    plcPrgVar:
      "rLt5 : DINT;\nrLt300 : DINT;\nrLt70000 : DINT;\nrLtBig : DINT;\nrLtMinus1 : DINT;\nrLtMinus200 : DINT;",
    plcPrgBody:
      "rLt5 := FUN_LANG_lt_literal_any_int_argument(5);\nrLt300 := FUN_LANG_lt_literal_any_int_argument(300);\nrLt70000 := FUN_LANG_lt_literal_any_int_argument(70000);\nrLtBig := FUN_LANG_lt_literal_any_int_argument(5000000000);\nrLtMinus1 := FUN_LANG_lt_literal_any_int_argument(-1);\nrLtMinus200 := FUN_LANG_lt_literal_any_int_argument(-200);",
    source: "FUNCTION FUN_LANG_lt_literal_any_int_argument : DINT\nVAR_INPUT\n\tx : ANY_INT;\nEND_VAR\nFUN_LANG_lt_literal_any_int_argument := x.diSize;\nEND_FUNCTION\n",
  },
]

// ─── LT13 — negative literals at a signed type's minimum ─────────────────────────────────────────────────────────────

const NEGATIVES: LanguageTest[] = [
  fb("lt_negative_min_sint", "-128 into a SINT, as an initializer and assigned", "\tsi : SINT := -128;\n\tsi2 : SINT;", "si2 := -128;"),
  fb("lt_negative_min_int", "-32768 into an INT, as an initializer and assigned", "\ti : INT := -32768;\n\ti2 : INT;", "i2 := -32768;"),
  fb("lt_negative_min_dint_lint", "DINT's and LINT's minimum, written as negated literals",
    "\td : DINT := -2147483648;\n\tl : LINT := -9223372036854775808;\n\td2 : DINT;\n\tl2 : LINT;",
    "d2 := -2147483648;\nl2 := -9223372036854775808;"),
  fb("lt_negative_below_min_sint", "-129 into a SINT", "\tsi : SINT;", "si := -129;"),
  fb("lt_negative_below_min_int", "-32769 into an INT", "\ti : INT;", "i := -32769;"),
]

export const LITERAL_CONTEXT_TESTS: readonly LanguageTest[] = [...CONTEXTS, ...NEGATIVES]
