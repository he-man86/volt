/**
 * Model state kept beside the frame (`frameState`) and beside the POU's shared state (`sharedState`): what the
 * `Lowering` fields and `Shared` fields it replaced were — created empty with their owner, one per owner, never shared
 * with another (task 1.6.21).
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { frameState, Lowering } from "./lowering.js"
import { newShared, sharedState } from "./shared.js"

const scope = {} as Scope

test("frameState: one state per frame, created empty at its first use and kept", () => {
  const seen = frameState(() => new Set<string>())
  const a = new Lowering(scope, scope)
  const b = new Lowering(scope, scope, a.shared)
  expect(seen(a).size).toBe(0)
  seen(a).add("X")
  expect(seen(a)).toBe(seen(a))
  expect([...seen(a)]).toEqual(["X"])
  // a second frame over the SAME shared state has its own — as a field of each `Lowering` was its own
  expect(seen(b).size).toBe(0)
})

test("sharedState: one state per POU lowering, the same from every frame that shares it", () => {
  const targets = sharedState(() => new Map<string, number>())
  const a = new Lowering(scope, scope)
  const nested = new Lowering(scope, scope, a.shared)
  const other = new Lowering(scope, scope, newShared())
  targets(a).set("P", 1)
  expect(targets(nested).get("P")).toBe(1)
  expect(targets(nested)).toBe(targets(a))
  expect(targets(other).size).toBe(0)
})
