/**
 * Aggregate initializer-list parser — turns `[…]` / `(…)` / `STRUCT(…)` inits into a structured element list
 * (array vs struct form; scalar / nested / field / repeat elements). Error-tolerant: unknown shapes and
 * unclassifiable elements degrade to `unknown` / `unparsed` rather than throwing.
 */
import { test, expect } from "bun:test"
import { parseSource, type AggregateInit, type AggregateElement } from "./index.js"

function agg(init: string): AggregateInit {
  const src = `PROGRAM P\nVAR\n  x : T := ${init};\nEND_VAR\nEND_PROGRAM`
  const unit = parseSource(src).units[0]
  if (unit === undefined || !("varSections" in unit)) throw new Error("expected a POU with a var section")
  const decl = unit.varSections[0].decls[0].init
  if (decl?.kind !== "aggregate_init") throw new Error(`expected an aggregate init, got ${decl?.kind}`)
  return decl
}

/** Compact structural rendering for assertions. */
function shape(e: AggregateElement): string {
  if (e.kind === "value") return e.expr.kind === "literal" ? e.expr.text : e.expr.kind
  if (e.kind === "nested") return `${e.init.form}[${e.init.elements.map(shape).join(",")}]`
  if (e.kind === "field") return `${e.name}:=${shape(e.value)}`
  if (e.kind === "repeat") return `rep(${shape(e.value)})`
  return "?" // unparsed
}
const shapes = (a: AggregateInit) => a.elements.map(shape)

test("array of scalars", () => {
  const a = agg("[1, 2, 3]")
  expect(a.form).toBe("array")
  expect(shapes(a)).toEqual(["1", "2", "3"])
})

test("struct fields (multi-field paren form)", () => {
  // A top-level `STRUCT(…)` parses as a call (named args), not an aggregate — the aggregate parser sees the
  // `STRUCT(…)` form only when nested (covered below). The multi-field paren form is the aggregate case.
  const s = agg("(p1 := 1, p2 := 2)")
  expect(s.form).toBe("struct")
  expect(shapes(s)).toEqual(["p1:=1", "p2:=2"])
})

test("nested arrays (multi-dimensional)", () => {
  expect(shapes(agg("[[1, 2], [3, 4]]"))).toEqual(["array[1,2]", "array[3,4]"])
})

test("repeat syntax counts and nests", () => {
  expect(shapes(agg("[3(0)]"))).toEqual(["rep(0)"])
  expect(shapes(agg("[1, 3(7), 2]"))).toEqual(["1", "rep(7)", "2"])
})

test("array of struct initializers, and a struct with a nested-array field", () => {
  expect(shapes(agg("[STRUCT(a := 1), STRUCT(a := 2)]"))).toEqual(["struct[a:=1]", "struct[a:=2]"])
  expect(shapes(agg("STRUCT(iBias := 60, p := [1, 2])"))).toEqual(["iBias:=60", "p:=array[1,2]"])
})

test("expression elements are kept as Exprs", () => {
  expect(shapes(agg("[foo, bar + 1]"))).toEqual(["ident_expr", "binary"])
})
