/**
 * The one diagnostic drain and the scratch lowering (task 1.7.6).
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { Lowering } from "./lowering.js"
import { drain, nested } from "./nested.js"

const scope = {} as Scope
const span = undefined as never

test("drain copies what was reported since a point — the source keeps it — and says whether there was any", () => {
  const into = new Lowering(scope, scope)
  const from = new Lowering(scope, scope, into.shared)
  from.bail("parse", "first", span)
  const before = from.diagnostics.length
  expect(drain(into, from, before)).toBe(false)
  from.bail("parse", "second", span)
  expect(drain(into, from, before)).toBe(true)
  expect(into.diagnostics.map((d) => d.message)).toEqual(["second"])
  expect(from.diagnostics.map((d) => d.message)).toEqual(["first", "second"])
  expect(drain(into, from)).toBe(true)
  expect(into.diagnostics.map((d) => d.message)).toEqual(["second", "first", "second"])
})

test("nested: a scratch lowering in its modes, sharing the POU's state, drained into the asker once", () => {
  const lw = new Lowering(scope, scope)
  const { value, drained } = nested(lw, scope, { routineMode: true, globalPrefix: "L." }, (scratch) => {
    expect(scratch.shared).toBe(lw.shared)
    expect([scratch.routineMode, scratch.globalMode, scratch.globalPrefix]).toEqual([true, false, "L."])
    scratch.bail("parse", "inside", span)
    return 7
  })
  expect([value, drained]).toEqual([7, true])
  expect(lw.diagnostics.map((d) => d.message)).toEqual(["inside"])
  expect(nested(lw, scope, {}, () => 0).drained).toBe(false)
})
