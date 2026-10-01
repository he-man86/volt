/**
 * The census's own reading of an expression's SHAPE (`memberShapes`) — what 0.3 and 0.4 count a member and a GVL's name
 * by. Asked of the AST, never of the order the dumps write their lines in: a call's arguments and an index's subscripts
 * are dumped between a member and its base, so "the line before" is not the member's root.
 */
import { expect, test } from "bun:test"
import { isTrivia, lex, parseExprFromTokens, type Expr } from "../../src/frontend/syntax/index.js"
import { memberShapes } from "./bound-census.js"

const expr = (src: string): Expr => {
  const e = parseExprFromTokens(lex(src, "codesys").filter((t) => !isTrivia(t.kind) && t.kind !== "eof"))
  if (e === undefined) throw new Error(`no expression: ${src}`)
  return e
}

test("a member's root is the name its chain starts at — not a name in an argument or a subscript before it", () => {
  // positions line:column, the column 0-based: `arr[undefIdx].nope` — arr 1:0, undefIdx 1:4, .nope's name 1:14
  expect([...memberShapes([expr("arr[undefIdx].nope")]).rootOf]).toEqual([["1:14", "1:0"]])
  // `foo(undefArg).m` — foo 1:0, m 1:14
  expect([...memberShapes([expr("foo(undefArg).m")]).rootOf]).toEqual([["1:14", "1:0"]])
  // a chain: both members start at `g`
  expect([...memberShapes([expr("g.a.b")]).rootOf]).toEqual([
    ["1:4", "1:0"],
    ["1:2", "1:0"],
  ])
})

test("a bare name qualifies only where it is a member's base — `GVL.g` and `GVL.f()`, never `GVL` alone", () => {
  expect([...memberShapes([expr("GVL_A.g")]).qualifiers]).toEqual(["1:0"])
  expect([...memberShapes([expr("GVL_A.f(1)")]).qualifiers]).toEqual(["1:0"])
  expect([...memberShapes([expr("GVL_A")]).qualifiers]).toEqual([])
  expect([...memberShapes([expr("x + GVL_A")]).qualifiers]).toEqual([])
})
