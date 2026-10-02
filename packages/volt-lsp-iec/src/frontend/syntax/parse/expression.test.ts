/**
 * THE EXPRESSION GRAMMAR against what the vendors record (openspec frontend-conformance, task 2.5; rules E1–E32 of design.md
 * §4 2.5). One test per recorded shape; the fixtures that recorded it (`test/conformance/fixtures/grammar/expressions.ts`,
 * both vendors 2026-10-01) are named in the title.
 */
import { expect, test } from "bun:test"
import { lex } from "../lex/lexer.js"
import type { BodySpan, Expr } from "../ast/nodes.js"
import type { Dialect } from "../lex/vocabulary.js"
import { bodyStatements } from "./body-parse.js"

function parse(body: string, dialect: Dialect = "codesys") {
  const toks = lex(body, dialect).filter((t) => t.kind !== "eof")
  const span = { start: 0, end: body.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  return bodyStatements({ kind: "body", tokens: toks, span } satisfies BodySpan)
}

/** The errors a body snippet parses with. */
const errors = (body: string, dialect: Dialect = "codesys"): string[] => parse(body, dialect).errors.map((e) => e.message)

/** An expression with its grouping made explicit: `(a OR (b XOR c))`. */
function shape(e: Expr): string {
  switch (e.kind) {
    case "binary":
      return `(${shape(e.left)} ${e.op} ${shape(e.right)})`
    case "unary":
      return `(${e.op} ${shape(e.operand)})`
    case "ident_expr":
      return e.name
    case "literal":
      return e.text
    case "paren":
      return shape(e.inner)
    default:
      return e.kind
  }
}

/** The grouping the parser reads `out := <expr>;` with — and that it reads it clean. */
function grouping(expr: string): string {
  const parsed = parse(`out := ${expr};`)
  expect(parsed.errors).toEqual([])
  const s = parsed.statements[0]
  if (s?.kind !== "assign") throw new Error(`not an assignment: ${expr}`)
  return shape(s.value)
}

test("the boolean levels: OR, OR_ELSE and XOR are ONE level, left to right; AND and AND_THEN bind tighter (expr_xor_between_or_and, expr_xor_then_or, expr_or_else_then_xor, expr_xor_then_or_else, expr_and_tighter_than_xor, expr_xor_then_and_then, expr_or_then_and_then, expr_or_else_then_and, expr_and_then_tighter_than_or_else, E1/E6)", () => {
  // run values, CODESYS 2026-10-01: `TRUE OR TRUE XOR TRUE` is FALSE — XOR does NOT bind tighter than OR, as IEC has it
  expect(grouping("a OR b XOR c")).toBe("((a OR b) XOR c)")
  expect(grouping("a XOR b OR c")).toBe("((a XOR b) OR c)")
  expect(grouping("a OR_ELSE b XOR c")).toBe("((a OR_ELSE b) XOR c)")
  expect(grouping("a XOR b OR_ELSE c")).toBe("((a XOR b) OR_ELSE c)")
  expect(grouping("a XOR b AND c")).toBe("(a XOR (b AND c))")
  expect(grouping("a XOR b AND_THEN c")).toBe("(a XOR (b AND_THEN c))")
  expect(grouping("a OR b AND_THEN c")).toBe("(a OR (b AND_THEN c))")
  expect(grouping("a OR_ELSE b AND c")).toBe("(a OR_ELSE (b AND c))")
  expect(grouping("a OR_ELSE b AND_THEN c")).toBe("(a OR_ELSE (b AND_THEN c))")
})

test("a comparison binds tighter than AND, and NOT tighter than a comparison (expr_equality_tighter_than_and, expr_not_tighter_than_comparison, E3/E6/E10)", () => {
  expect(grouping("a = b AND c")).toBe("((a = b) AND c)")
  expect(grouping("NOT a = b")).toBe("((NOT a) = b)")
})

test("comparison chains: `<` tighter than `=`, each level left to right (expr_comparison_chain, expr_equality_chain, expr_comparison_chain_same_level, E9)", () => {
  expect(grouping("a < b = c")).toBe("((a < b) = c)")
  expect(grouping("a = b = c")).toBe("((a = b) = c)")
  expect(grouping("a < b < c")).toBe("((a < b) < c)")
})

test("MOD binds as `*` does, tighter than `+`, and every level is left-associative (expr_mod_precedence, expr_mod_same_level_as_mul, expr_div_left_assoc, E4/E7)", () => {
  expect(grouping("a + b MOD c")).toBe("(a + (b MOD c))")
  expect(grouping("a * b MOD c")).toBe("((a * b) MOD c)")
  expect(grouping("a / b / c")).toBe("((a / b) / c)")
})

test("unary `-`, `+` and NOT stack in any order and stand as a binary operator's right operand (expr_unary_plus, expr_double_minus, expr_minus_minus_adjacent, expr_plus_plus, expr_not_not, expr_minus_not, expr_not_minus, expr_minus_after_*, E10/E11)", () => {
  expect(grouping("+a")).toBe("(+ a)")
  expect(grouping("- -a")).toBe("(- (- a))")
  expect(grouping("--a")).toBe("(- (- a))")
  expect(grouping("+ +a")).toBe("(+ (+ a))")
  expect(grouping("NOT NOT a")).toBe("(NOT (NOT a))")
  expect(grouping("-NOT a")).toBe("(- (NOT a))")
  expect(grouping("NOT -a")).toBe("(NOT (- a))")
  expect(grouping("a - -b")).toBe("(a - (- b))")
  expect(grouping("a * -b")).toBe("(a * (- b))")
})

test("`**` is no operator: the statement ends before it, and the parse resyncs as after a missing `;` (expr_power_right_assoc, expr_neg_power, cc_power_operator, E5/E8)", () => {
  expect(errors("out := a ** b ** c;")).toEqual([
    "';' expected instead of '**'",
    "Unexpected token '**' found",
    "';' expected instead of 'b'",
    "';' expected instead of '**'",
    "Unexpected token '**' found",
    "';' expected instead of 'c'",
  ])
  expect(errors("out := -a ** b;")).toEqual(["';' expected instead of '**'", "Unexpected token '**' found", "';' expected instead of 'b'"])
  expect(errors("x := 2.0 ** 3.0;")).toEqual([
    "';' expected instead of '**'",
    "Unexpected token '**' found",
    "';' expected instead of '3.0'",
    "Unexpected token '3.0' found",
  ])
})

test("the statements the resync resumes at stand, the one without its `;` marked so (expr_power_right_assoc: 'b;' and 'c;' have no effect)", () => {
  const { statements } = parse("out := a ** b ** c;")
  expect(statements.map((s) => [s.kind, s.kind === "expr_stmt" ? `${shape(s.expr)}${s.resumed ? " resumed" : ""}${s.unterminated ? " unterminated" : ""}` : ""])).toEqual([
    ["assign", ""],
    ["expr_stmt", "b resumed unterminated"],
    ["expr_stmt", "c resumed"],
  ])
})

test("`&` is no operator either — whatever reads the expression says what it wanted instead (cc_fp_op_ampersand, expr_ampersand_in_*, E2)", () => {
  expect(errors("c := a & b;")).toEqual(["';' expected instead of '&'", "Unexpected token '&' found", "';' expected instead of 'b'"])
  // parentheses: their `)`, then the statement's resync from the `&`
  expect(errors("out := (a & b);")).toEqual([
    "')' expected instead of '&'",
    "';' expected instead of '&'",
    "Unexpected token '&' found",
    "';' expected instead of 'b'",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
  ])
  // a call's list: its `,` or `)`, and nothing more
  expect(errors("out := F(a & b, c);")).toEqual(["',' or ')' expected instead of '&'"])
  // an IF: its THEN, resumed in silence where the THEN stands (expr_if_condition_stray_name too)
  expect(errors("IF a & b THEN\n\tout := 1;\nEND_IF")).toEqual(["'THEN' expected instead of '&'"])
  expect(errors("IF a b THEN\n\tout := 1;\nEND_IF")).toEqual(["'THEN' expected instead of 'b'"])
})

test("a prefix `&` is no operand: refused on the mark, then the statement's resync (expr_prefix_ampersand, E11)", () => {
  expect(errors("out := &a;")).toEqual([
    "Expression expected instead of '&'",
    "';' expected instead of '&'",
    "Unexpected token '&' found",
    "';' expected instead of 'a'",
  ])
})

test("a parenthesis left open where a name stands: its `)`, then the name read as a statement (expr_paren_stray_name, E24)", () => {
  expect(errors("out := (a b);")).toEqual([
    "')' expected instead of 'b'",
    "';' expected instead of 'b'",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
  ])
})

test("every index is an expression: no empty list, no trailing comma (expr_index_empty, expr_trailing_comma_index*, E15/E16)", () => {
  expect(errors("out := arr[];")).toEqual(["Expression expected instead of ']'"])
  expect(errors("out := arr[1,];")).toEqual(["Expression expected instead of ']'"])
  expect(errors("out := grid[1, 2,];")).toEqual(["Expression expected instead of ']'"])
  expect(errors("out := grid[1, 2];")).toEqual([])
})

test("a trailing comma is taken in a user call's list and refused in an operator's (expr_trailing_comma_call, _formal_call, _fb_call, _operator_call, E16/E28)", () => {
  expect(errors("out := F(a, b,);")).toEqual([])
  expect(errors("out := F(x := a, y := b,);")).toEqual([])
  expect(errors("inner(x := a,);")).toEqual([])
  expect(errors("out := MAX(a, b,);")).toEqual(["Expression expected instead of ')'"])
})

test("the IL call form of an operator keyword is refused on the word, then the statement's resync (operator_call_form_*, expr_operator_call_form_lower_case, E31)", () => {
  expect(errors("added := ADD(a, b);")).toEqual([
    "Expression expected instead of 'ADD'",
    "';' expected instead of 'ADD'",
    "Unexpected token 'ADD' found",
    "';' expected instead of '('",
    "Unexpected token '(' found",
    "';' expected instead of 'a'",
    "';' expected instead of ','",
    "Unexpected token ',' found",
    "';' expected instead of 'b'",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
  ])
  for (const op of ["SUB", "MUL", "DIV", "GT", "LT", "LE", "GE", "EQ", "NE", "add", "gt"])
    expect(errors(`r1 := ${op}(a, b);`)[0]).toBe(`Expression expected instead of '${op}'`)
})

test("…and a binary operator word as a call reads `(a` as its right operand (expr_operator_call_form_mod, _and, E31)", () => {
  for (const op of ["MOD", "AND"])
    expect(errors(`out := ${op}(a, b);`)).toEqual([
      `Expression expected instead of '${op}'`,
      "')' expected instead of ','",
      "';' expected instead of ','",
      "Unexpected token ',' found",
      "';' expected instead of 'b'",
      "';' expected instead of ')'",
      "Unexpected token ')' found",
    ])
  expect(errors("out := NOT(a);")).toEqual([]) // NOT is unary, and `(a)` its operand (expr_operator_call_form_not)
})

test("any keyword is read as a member's name, and refused as no component, naming the base as written (expr_member_named_*, E32)", () => {
  for (const kw of ["END_IF", "MOD", "ABS"]) expect(errors(`out := bx.${kw};`)).toEqual([`'${kw}' is no component of 'bx'`])
  // a soft name is a name a component can bear
  expect(errors("out := bx.GET;")).toEqual([])
})

test("a partial access is one member on CODESYS; on TwinCAT the `%` is the member, no component, and the specifier is left over (accepts_partial_access, operand_partial_*, E14)", () => {
  expect(errors("word0 := d.%W0;")).toEqual([])
  expect(errors("word0 := d.%W0;", "twincat")).toEqual(["'%' is no component of 'd'", "';' expected instead of 'W0'"])
  const { statements } = parse("word0 := d.%W0;", "twincat")
  expect(statements.map((s) => (s.kind === "expr_stmt" ? `${shape(s.expr)}${s.resumed ? " resumed" : ""}` : s.kind))).toEqual([
    "assign",
    "W0 resumed",
  ])
})

test("a CASE label is read with the expression grammar: signed, typed, qualified and ranged labels open an arm, a statement does not", () => {
  const { statements, errors: errs } = parse(
    "CASE x OF\n-5: y := 1;\nINT#6: y := 2;\nE.Val, 1..3: y := 3;\n7: f(y);\nELSE\ny := 5;\nEND_CASE",
  )
  expect(errs).toEqual([])
  const c = statements[0]
  if (c?.kind !== "case") throw new Error("not a CASE")
  expect(c.arms.map((a) => a.labels.length)).toEqual([1, 1, 2, 1])
  expect(c.arms.map((a) => a.body.length)).toEqual([1, 1, 1, 1])
})

test("a CASE label is a literal, a signed literal or a (qualified) name, never an expression: `a + 1:` is the statement before a colon (stmt_case_nonconst_label, stmt_case_const_expr_label, stmt_case_paren_label, ST8)", () => {
  expect(errors("CASE a OF\n1: out := 1;\na + 1: out := 2;\nEND_CASE")).toEqual([
    "';' expected instead of ':'",
    "Unexpected token ':' found",
    "';' expected instead of 'out'",
  ])
  for (const label of ["2 + 1", "(2)"]) {
    const { statements } = parse(`CASE a OF\n1: out := 1;\n${label}: out := 2;\nEND_CASE`)
    const c = statements[0]
    if (c?.kind !== "case") throw new Error("not a CASE")
    expect(c.arms.length).toBe(1)
  }
})

test("a statement missing its `;` before the next CASE arm says so once, and the arm is read (stmt_case_arm_missing_semicolon, ST8/ST13)", () => {
  const { statements, errors: errs } = parse("CASE a OF\n1: out := 2\n2: out := 3;\nEND_CASE")
  expect(errs.map((e) => e.message)).toEqual(["';' expected instead of '2'"])
  const c = statements[0]
  if (c?.kind !== "case") throw new Error("not a CASE")
  expect(c.arms.map((a) => a.body.length)).toEqual([1, 1])
})

test("a parenthesis left open in an IF or WHILE condition: its `)`, and the IF / WHILE resumes at THEN / DO in silence (expr_paren_stray_name_in_if, _in_while, E24)", () => {
  expect(errors("IF (a b) THEN\n\tout := 1;\nEND_IF")).toEqual(["')' expected instead of 'b'"])
  expect(errors("WHILE (a b) DO\n\tout := 1;\nEND_WHILE")).toEqual(["')' expected instead of 'b'"])
  const { statements } = parse("IF (a b) THEN\n\tout := 1;\nEND_IF")
  const s = statements[0]
  if (s?.kind !== "if") throw new Error("not an IF")
  expect(s.branches[0]?.body.length).toBe(1)
})

test("a parenthesis left open in an index: its `)`, the index list's `,` or `]` taking the token, then the statement's resync (expr_paren_stray_name_in_index, E24)", () => {
  expect(errors("out := arr[(1 2)];")).toEqual([
    "')' expected instead of '2'",
    "',' or ']' expected instead of '2'",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
    "';' expected instead of ']'",
    "Unexpected token ']' found",
  ])
})

test("an operator's trailing comma counts an empty operand: one too many for a one-operand operator (expr_trailing_comma_one_operand_operator, expr_trailing_comma_sizeof, E16/E28)", () => {
  expect(errors("out := ABS(a,);")).toEqual(["'ABS' needs exactly '1' operands", "Expression expected instead of ')'"])
  expect(errors("out := SIZEOF(a,);")).toEqual(["'SIZEOF' needs exactly '1' operands", "Expression expected instead of ')'"])
  expect(errors("out := ABS(a & b);")).toEqual(["',' or ')' expected instead of '&'"]) // expr_ampersand_in_operator_argument
})

test("a binary operator word reads a signed operand after it (expr_operator_word_before_minus, _plus, E31)", () => {
  expect(errors("out := AND -a;")).toEqual(["Expression expected instead of 'AND'"])
  expect(errors("out := MOD +a;")).toEqual(["Expression expected instead of 'MOD'"])
})

test("TwinCAT's `d.%W0` is a parse refusal: nothing after it in the body is analysed (expr_partial_access_beside_undefined, E32)", () => {
  expect(parse("out := d.%W0;\nq := nope;", "twincat").ok).toBe(false)
  expect(errors("out := d.%W0;\nq := nope;")).toEqual([])
})

// ─── task 2.5.6: E24, E26, E33 (`fixtures/grammar/expressions.ts`, both vendors 2026-10-02) ─────────────────────────

test("empty parentheses are the vendors' one \"Expression expected instead of ')'\" (expr_paren_empty, E24)", () => {
  expect(errors("out := ();")).toEqual(["Expression expected instead of ')'"])
  expect(errors("out := ();", "twincat")).toEqual(["Expression expected instead of ')'"])
})

test("an inline assignment stands unparenthesised wherever an expression is read: a CASE selector, a FOR bound, an index (expr_inline_assign_case_selector, _for_bound, _index, E26)", () => {
  expect(errors("CASE a := b OF\n2: out := 1;\nEND_CASE")).toEqual([])
  expect(errors("FOR i := 1 TO m := 3 DO\n\tout := out + i;\nEND_FOR")).toEqual([])
  expect(errors("FOR i := 1 TO 9 BY m := 3 DO\n\tout := out + i;\nEND_FOR")).toEqual([])
  expect(errors("out := arr[i := 2];")).toEqual([])
  const s = parse("CASE a := b OF\n2: out := 1;\nEND_CASE").statements[0]
  if (s?.kind !== "case") throw new Error("not a CASE")
  expect(s.selector.kind).toBe("assign_expr")
})

test("a leading dot names the GLOBAL: `.g` is one global_expr, as an operand, an assignment target, a member base and a callee, a space after the dot allowed (expr_global_namespace_*, E33)", () => {
  for (const dialect of ["codesys", "twincat"] as const) {
    expect(errors("out := .gDot;", dialect)).toEqual([])
    expect(errors("out := . gSpace;", dialect)).toEqual([])
    expect(errors(".gTarget := 5;\nout := .gTarget + gTarget;", dialect)).toEqual([])
    expect(errors("out := .gBox.v;", dialect)).toEqual([])
    expect(errors("out := .F(a, b);", dialect)).toEqual([])
  }
  const value = (body: string): Expr => {
    const s = parse(body).statements[0]
    if (s?.kind !== "assign") throw new Error(`not an assignment: ${body}`)
    return s.value
  }
  const g = value("out := .gDot;")
  expect(g.kind).toBe("global_expr")
  if (g.kind === "global_expr") expect(g.name.name).toBe("gDot")
  const m = value("out := .gBox.v;")
  expect(m.kind === "member" && m.base.kind).toBe("global_expr")
  const c = value("out := .F(a, b);")
  expect(c.kind === "call" && c.callee.kind).toBe("global_expr")
  const t = parse(".gTarget := 5;").statements[0]
  expect(t?.kind === "assign" && t.target.kind).toBe("global_expr")
})

// …and as a FOR loop's START value, after the control variable's own `:=`: `FOR i := m := 1 TO 3 DO` builds and runs
// (m 1, i 4, out 6 — `expr_inline_assign_for_start`, both vendors 2026-10-02). It was refused with three syntax errors.
test("an inline assignment as a FOR start value: `FOR i := m := 1 TO 3 DO` (expr_inline_assign_for_start, E26)", () => {
  for (const dialect of ["codesys", "twincat"] as const)
    expect(errors("FOR i := m := INT#1 TO INT#3 DO\n\tout := out + i;\nEND_FOR", dialect)).toEqual([])
  const s = parse("FOR i := m := 1 TO 3 DO\nEND_FOR").statements[0]
  if (s?.kind !== "for") throw new Error("not a FOR")
  expect(s.from.kind).toBe("assign_expr")
})
