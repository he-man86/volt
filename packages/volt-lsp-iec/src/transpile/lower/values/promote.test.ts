/**
 * The one operand meet (task 1.7.15) and its three contexts.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import type { IrExpr } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { meet } from "./promote.js"

const span = undefined as never
const lw = new Lowering({} as Scope, {} as Scope)
const ty = (name: string) => elementaryRef(name)
const variable = (t: Type): IrExpr => ({ kind: "load", place: { slot: 0, path: [], type: t, span }, type: t, span })
const constant = (value: bigint | number, t: Type): IrExpr => ({ kind: "const", value, type: t, span })
const name = (t: Type | undefined) => (t as { elem?: { name: string } } | undefined)?.elem?.name

test("binary: a literal beside a narrow variable takes the promoted type, the meet is promoted when the operator lifts", () => {
  const met = meet(lw, [variable(ty("SINT")), constant(1000n, ty("INT"))], { kind: "binary", lift: true, operator: "+" }, span)!
  expect(name(met.type)).toBe("DINT")
  expect(met.operands.map((o) => name(o.type))).toEqual(["SINT", "DINT"])
  const unlifted = meet(lw, [variable(ty("SINT")), variable(ty("SINT"))], { kind: "binary", lift: false, operator: "SHL" }, span)!
  expect(name(unlifted.type)).toBe("SINT")
})

test("binary: two integer constants fold at full width", () => {
  const met = meet(lw, [constant(1n, ty("INT")), constant(2n, ty("INT"))], { kind: "binary", lift: true, operator: "+" }, span)!
  expect(met.operands.map((o) => name(o.type))).toEqual(["LINT", "LINT"])
})

test("builtin: the variables decide and a REAL constant widens; the operands are not retyped", () => {
  const ops = [variable(ty("INT")), constant(2.5, ty("LREAL"))]
  const met = meet(lw, ops, { kind: "builtin" }, span)!
  expect(name(met.type)).toBe("LREAL")
  expect(met.operands).toEqual(ops)
})

test("for-compare: the counter's and the limit's common type, unpromoted", () => {
  expect(name(meet(lw, [variable(ty("INT")), variable(ty("DINT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
  expect(name(meet(lw, [variable(ty("SINT")), variable(ty("SINT"))], { kind: "for-compare" }, span)!.type)).toBe("SINT")
})
