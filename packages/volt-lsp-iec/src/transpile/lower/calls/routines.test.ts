/**
 * `once` — the one writer of the routine cache (task 1.7.8) (task 1.7.8).
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { IrRoutine } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { once } from "./routines.js"

const scope = {} as Scope
const span = undefined as never
const routine = (name: string): IrRoutine => ({ name, key: name.toUpperCase(), kind: "method", locals: [], inputs: [], inouts: [], body: [] }) as never

test("once: built once and cached; a failure is refused by name on every later ask, a call reached while building as recursion", () => {
  const lw = new Lowering(scope, scope)
  let builds = 0
  const r = once(lw, "F", span, () => (builds++, routine("F")))
  expect(once(lw, "f", span, () => (builds++, routine("F")))).toBe(r!)
  expect(builds).toBe(1)
  expect(once(lw, "G", span, () => undefined)).toBeUndefined()
  expect(once(lw, "G", span, () => routine("G"))).toBeUndefined()
  expect(once(lw, "H", span, () => once(lw, "H", span, () => routine("H")))).toBeUndefined()
  expect(lw.diagnostics.map((d) => d.code)).toEqual(["call-body", "call-recursive"])
})

test("once quiet: a built routine's failure is not refused again, and it has no recursion guard", () => {
  const lw = new Lowering(scope, scope)
  expect(once(lw, "I", span, () => undefined, { quiet: true })).toBeUndefined()
  expect(once(lw, "I", span, () => routine("I"), { quiet: true })).toBeUndefined()
  expect(once(lw, "J", span, () => once(lw, "J", span, () => routine("J"), { quiet: true }), { quiet: true })?.name).toBe("J")
  expect(lw.diagnostics).toEqual([])
  expect([...lw.routines.keys()]).toEqual(["I", "J"])
})

