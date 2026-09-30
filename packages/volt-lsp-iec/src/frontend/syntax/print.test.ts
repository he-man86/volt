/**
 * Round-trip oracle for the ONE type-expression renderer: for a battery of real ST types, `renderTypeExpr(parse(t))`
 * must reproduce every meaningful token of `t`. A failure means the type parser silently dropped or reordered a token
 * into the AST — a data-loss bug the "does it error?" tests can't see (whitespace is ignored: token streams compare).
 * It used to exercise a second TypeExpr printer under `transpile/`, which nothing else called.
 */
import { expect, test } from "bun:test"
import { isTrivia, lex, parseSource, renderTypeExpr, type TypeExpr } from "./index.js"

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
