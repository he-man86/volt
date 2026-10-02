/**
 * Round-trip oracle for the ONE type-expression renderer: for a battery of real ST types, `renderTypeExpr(parse(t))`
 * must reproduce every meaningful token of `t`. A failure means the type parser silently dropped or reordered a token
 * into the AST — a data-loss bug the "does it error?" tests can't see (whitespace is ignored: token streams compare).
 * It used to exercise a second TypeExpr printer under `transpile/`, which nothing else called.
 */
import { expect, test } from "bun:test"
import { compilerTypeText, type Expr, exprText, isTrivia, lex, parseSource, renderTypeExpr, type Span, type TypeExpr } from "./index.js"

/** The meaningful (non-trivia) token stream as `kind:text` pairs — the whitespace-insensitive identity. */
const toks = (s: string): string[] =>
  lex(s, "codesys")
    .filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
    .map((t) => `${t.kind}:${t.text}`)

/** Parse `x : <type>;` and return the type node + its exact source text. */
function typeOf(typeSrc: string): { node: TypeExpr; src: string } {
  const source = `FUNCTION_BLOCK F\nVAR\n x : ${typeSrc};\nEND_VAR\nEND_FUNCTION_BLOCK`
  const unit = parseSource(source, { networkText: true }).units[0]
  if (unit?.kind !== "function_block") throw new Error(`not an FB: ${typeSrc}`)
  const node = unit.varSections[0]!.decls[0]!.type
  return { node, src: source.slice(node.span.start, node.span.end) }
}

const TYPES = [
  "BOOL",
  "INT",
  "Tc2_Standard.TON",
  "INT(1..100)",
  "ARRAY[0..9] OF INT",
  "ARRAY[0..9, 1..10] OF REAL",
  "ARRAY[*] OF INT",
  "POINTER TO INT",
  "REFERENCE TO BOOL",
  "STRING",
  "STRING(80)",
  "WSTRING(255)",
  "POINTER TO ARRAY[0..9] OF INT",
  "ARRAY[0..1] OF POINTER TO Tc2_Standard.TON",
  // a CODESYS vector is not an array: it printed as `ARRAY[0..4 - 1] OF REAL`, so formatting rewrote the user's type
  // (frontend-conformance 2.1.4, L11 — `type_codesys_vector`, `lex_vector_twincat`)
  "__VECTOR[4] OF REAL",
  "__VECTOR[N + 1] OF INT",
]

test("renderTypeExpr round-trips every meaningful token (parser data-loss oracle)", () => {
  for (const ty of TYPES) {
    const { node, src } = typeOf(ty)
    expect(toks(renderTypeExpr(node))).toEqual(toks(src))
  }
})

// PR2 (frontend-conformance 2.9): a STRING's length is written in `(…)` or `[…]`, and either closer ends either opener
// (`decl_string_brackets`, `_mismatched`, `_mismatched_other`, both vendors build all three). The printer wrote `(…)` for
// every one, so formatting rewrote `STRING[80]` — the same type, but not the engineer's text.
test("STRING[n] round-trips", () => {
  for (const ty of ["STRING[80]", "STRING(80]", "STRING[80)", "STRING(80)", "STRING[N + 1]", "WSTRING(10)"]) {
    const { node, src } = typeOf(ty)
    expect(renderTypeExpr(node)).toBe(src)
  }
})

// PR3 (frontend-conformance 2.9): a parsed tree holds its parentheses (`paren`), but a tree a code action builds does not
// — printed without them, `(a + b) * c` became `a + b * c`, a different expression. The printer now parenthesizes a
// child its parent would otherwise capture, by the parser's own table (`BINARY_PRECEDENCE`, every level left-associative;
// unary and postfix bind tighter than every binary).
test("nested binary gets precedence parentheses", () => {
  const sp: Span = { start: 0, end: 0, startLine: 0, startCol: 0, endLine: 0, endCol: 0 }
  const id = (name: string): Expr => ({ kind: "ident_expr", name, span: sp })
  const bin = (op: string, left: Expr, right: Expr): Expr => ({ kind: "binary", op, left, right, span: sp })
  const cases: [Expr, string][] = [
    [bin("*", bin("+", id("a"), id("b")), id("c")), "(a + b) * c"],
    [bin("*", id("c"), bin("+", id("a"), id("b"))), "c * (a + b)"],
    [bin("+", bin("*", id("a"), id("b")), id("c")), "a * b + c"],
    // left-associative: the left operand of an equal level needs none, the right one does
    [bin("-", bin("-", id("a"), id("b")), id("c")), "a - b - c"],
    [bin("-", id("a"), bin("-", id("b"), id("c"))), "a - (b - c)"],
    // OR and XOR are ONE level (`expr_xor_between_or_and`)
    [bin("XOR", id("a"), bin("OR", id("b"), id("c"))), "a XOR (b OR c)"],
    [bin("AND", bin("OR", id("a"), id("b")), id("c")), "(a OR b) AND c"],
    [bin("=", bin("<", id("a"), id("b")), id("c")), "a < b = c"],
    [{ kind: "unary", op: "-", operand: bin("+", id("a"), id("b")), span: sp }, "-(a + b)"],
    [{ kind: "unary", op: "NOT", operand: bin("AND", id("a"), id("b")), span: sp }, "NOT (a AND b)"],
    [{ kind: "member", base: bin("+", id("a"), id("b")), member: { kind: "ident_expr", name: "x", span: sp }, span: sp }, "(a + b).x"],
    [bin("+", { kind: "assign_expr", target: id("x"), value: id("v"), span: sp }, id("b")), "(x := v) + b"],
  ]
  for (const [e, text] of cases) expect(exprText(e)).toBe(text)
  // …and a parsed tree, which carries its own parentheses, prints as written — never a second pair
  for (const src of ["(a + b) * c", "a - (b - c)", "NOT (a AND b)", "a + b * c", "-(a)"]) {
    const unit = parseSource(`PROGRAM P\nVAR\n x : INT := ${src};\nEND_VAR\nEND_PROGRAM`, { networkText: true }).units[0]
    if (unit?.kind !== "program") throw new Error("not a program")
    const init = unit.varSections[0]!.decls[0]!.init
    if (init === undefined || init.kind === "aggregate_init") throw new Error(`no expression initializer: ${src}`)
    expect(exprText(init)).toBe(src)
  }
})

// …and a diagnostic message names the same type in the vendor's spelling: the compiler normalises the delimiters to
// `(…)` (`decl_string_brackets` records 'STRING(5)' for `STRING[5]`), through an ARRAY's element and a POINTER's target too.
test("compilerTypeText spells every STRING length in parentheses", () => {
  const cases: [string, string][] = [
    ["STRING[80]", "STRING(80)"],
    ["STRING(80]", "STRING(80)"],
    ["STRING[N + 1]", "STRING(N + 1)"],
    ["ARRAY[0..1] OF STRING[4]", "ARRAY[0..1] OF STRING(4)"],
    ["POINTER TO STRING[4)", "POINTER TO STRING(4)"],
    ["WSTRING(10)", "WSTRING(10)"],
  ]
  for (const [written, compiler] of cases) expect(compilerTypeText(typeOf(written).node)).toBe(compiler)
})
