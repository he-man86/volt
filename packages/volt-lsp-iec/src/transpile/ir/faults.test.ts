/**
 * `ir/faults.ts` `cannotFault` (gate 7.4c): which IR could stop the task — an allowlist, so what it does not name counts as
 * one that could. Lowering takes a lent Standard string input where it is written when both it and a later argument
 * could fault (`lower/calls/string-inputs.ts`), and the emitter hoists an input that could fault before such a freeze.
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import type { IrExpr, Place } from "./expr.js"
import { cannotFault } from "./faults.js"

const INT = elementaryRef("INT")
const span = { uri: "f", start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } as never
const c = (value: bigint): IrExpr => ({ kind: "const", value, type: INT, span })
const place = (slot: number, ...index: IrExpr[]): Place => ({ slot, path: index.map((i) => ({ kind: "index" as const, index: i, lower: 0n })), type: INT, span })
const load = (p: Place): IrExpr => ({ kind: "load", place: p, type: INT, span })
const div = (left: IrExpr, right: IrExpr, nonzeroDivisor?: true): IrExpr => ({ kind: "binary", op: "div", left, right, type: INT, span, ...(nonzeroDivisor ? { nonzeroDivisor } : {}) })
const builtin = (name: Extract<IrExpr, { kind: "builtin" }>["name"], ...args: IrExpr[]): IrExpr => ({ kind: "builtin", name, args, type: INT, span })

test("a constant, a load of a place with constant indices, and the operators and conversions over them cannot fault", () => {
  expect(cannotFault(c(1n))).toBe(true)
  expect(cannotFault(load(place(0, c(2n))))).toBe(true)
  expect(cannotFault({ kind: "binary", op: "add", left: load(place(0)), right: c(1n), type: INT, span })).toBe(true)
  expect(cannotFault({ kind: "convert", value: load(place(0)), type: elementaryRef("DINT"), span })).toBe(true)
  expect(cannotFault(div(load(place(0)), c(2n), true))).toBe(true)
  expect(cannotFault(builtin("abs", load(place(0))))).toBe(true)
})

test("a runtime index, a dereference, a division by what could be 0, a faulting builtin or any call could", () => {
  expect(cannotFault(load(place(0, load(place(1)))))).toBe(false)
  expect(cannotFault(load({ ...place(0), guard: place(1) }))).toBe(false)
  expect(cannotFault(div(load(place(0)), load(place(1))))).toBe(false)
  for (const name of ["expt", "ln", "log", "char"] as const) expect([name, cannotFault(builtin(name, load(place(0))))]).toEqual([name, false])
  expect(cannotFault({ kind: "invoke", routine: "F", inputs: [], inouts: [], type: INT, span })).toBe(false)
  // at any depth: a faulting index under a conversion
  expect(cannotFault({ kind: "convert", value: load(place(0, div(c(1n), load(place(1))))), type: elementaryRef("DINT"), span })).toBe(false)
})
