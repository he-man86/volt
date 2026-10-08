/**
 * The one operand meet (task 1.7.15) and its three contexts.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import { run } from "../../interp/index.js"
import type { IrExpr } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { lowerSource } from "../index.js"
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

// two types meet promoted (`for_limit_sign_change_uint_counter_out_of_int_range`, `_uint_limit_out_of_int_range`)
test("for-compare: one type stays itself; two meet in their common type, promoted", () => {
  expect(name(meet(lw, [variable(ty("INT")), variable(ty("DINT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
  expect(name(meet(lw, [variable(ty("SINT")), variable(ty("SINT"))], { kind: "for-compare" }, span)!.type)).toBe("SINT")
  expect(name(meet(lw, [variable(ty("UINT")), variable(ty("INT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
  expect(name(meet(lw, [variable(ty("UDINT")), variable(ty("DINT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
})

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// transpile-review 6: an untyped literal beside a variable took the neighbour's type even when it did not fit, and wrapped
// (`x + -3000000000` was 1294967301). CODESYS (`tr_6_literal_beyond_dint_neighbour`): the literal keeps its own type and the
// pair meets — a UDINT literal beside a DINT at LINT; MAX(ud, 5000000000) is 5000000000.
test("an integer literal that does not fit its neighbour's type keeps its own and meets it wider", () => {
  const vars = "x : DINT := 5; ud : UDINT := 3; g1 : BOOL; s1 : LINT; s2 : LINT; g2 : BOOL; g3 : BOOL; g4 : BOOL; m : LINT; mx : LINT;"
  const body = [
    "g1 := x > -3000000000;",
    "s1 := x + -3000000000;",
    "s2 := ud + 5000000000;",
    "g2 := ud > 5000000000;",
    "g3 := x > 3000000000;",
    "g4 := 3000000000 < x;",
    "m := ud * 5000000000;",
    "mx := MAX(ud, 5000000000);",
  ].join("\n")
  const runner = run(ir(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P"))
  runner.scan()
  expect(["g1", "s1", "s2", "g2", "g3", "g4", "m", "mx"].map((n) => runner.get(n))).toEqual([
    true, -2999999995n, 5000000003n, false, false, false, 15000000000n, 5000000000n,
  ])
})
