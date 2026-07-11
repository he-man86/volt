/**
 * Round-trip oracle: for a battery of real ST types, `printType(parse(t))` must reproduce every meaningful
 * token of `t`. A failure means the type parser silently dropped or reordered a token into the AST — a
 * data-loss bug the "does it error?" tests can't see. (Whitespace is ignored: we compare the token stream.)
 */
import { test, expect } from "bun:test"
import { lex, isTrivia, parseSource, type TypeExpr } from "../syntax/index.js"
import { printType } from "./print.js"

/** The meaningful (non-trivia) token stream as `kind:text` pairs — the whitespace-insensitive identity. */
const toks = (s: string): string[] =>
  lex(s)
    .filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
    .map((t) => `${t.kind}:${t.text}`)

/** Parse `x : <type>;` and return the type node + its exact source span text. */
function typeOf(typeSrc: string): { node: TypeExpr; src: string; source: string } {
  const source = `FUNCTION_BLOCK F\nVAR\n x : ${typeSrc};\nEND_VAR\nEND_FUNCTION_BLOCK`
  const unit = parseSource(source).units[0]
  if (unit?.kind !== "function_block") throw new Error(`not an FB: ${typeSrc}`)
  const node = unit.varSections[0]!.decls[0]!.type
  return { node, src: source.slice(node.span.start, node.span.end), source }
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
]

test("printType round-trips every meaningful token (parser data-loss oracle)", () => {
  for (const ty of TYPES) {
    const { node, src, source } = typeOf(ty)
    expect(toks(printType(node, source))).toEqual(toks(src))
  }
})
