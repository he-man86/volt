/**
 * The one field lookup and the one path walk (task 1.7.10): case-insensitive lookup, and each walk rule.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import type { Access, IrSlot } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { fieldIn, fieldIndex, fieldOf, sameStep, sameTarget, staticKey, staticPath, suffixOf, typeAlong } from "./path.js"

const INT = elementaryRef("INT")
const slot = (name: string, type: Type = INT): IrSlot => ({ name, type, section: "VAR", init: 0n })
const lw = new Lowering({} as Scope, {} as Scope)
const fb = { kind: "function_block", name: "FB_A" } as Type
const st = { kind: "struct", name: "ST_B" } as Type
const sized = { kind: "array", element: st, bounds: [{ lower: 0n, upper: 3n }], dims: [{}] } as unknown as Type
const open = { kind: "array", element: st, dims: [{}] } as unknown as Type
lw.layouts.set("FB_A", { name: "FB_A", kind: "function_block", fields: [slot("Inner", st)] } as never)
lw.layouts.set("ST_B", { name: "ST_B", kind: "struct", fields: [slot("x"), slot("arr", sized), slot("open", open)] } as never)
const field = (name: string): Access => ({ kind: "field", name })
const index: Access = { kind: "index", index: { kind: "const", value: 1n, type: INT, span: undefined as never }, lower: 0n }

test("a field by name, whatever its case — or none", () => {
  const fields = [slot("Alpha"), slot("beta")]
  expect(fieldIn(fields, "ALPHA")?.name).toBe("Alpha")
  expect(fieldIn(fields, "Beta")?.name).toBe("beta")
  expect(fieldIn(fields, "gamma")).toBeUndefined()
  expect(fieldIn(undefined, "x")).toBeUndefined()
  expect(fieldIndex(fields, "BETA")).toBe(1)
  expect(fieldIndex(undefined, "x")).toBe(-1)
  expect(fieldOf(lw, "st_b", "X")?.name).toBe("x")
})

test("typeAlong: a struct rule does not enter an FB, a composite one does; sized vs any element", () => {
  const along = (root: Type, path: Access[], rule: Parameters<typeof typeAlong>[3]) => typeAlong(lw, root, path, rule, () => undefined)
  expect(along(fb, [field("inner")], { fields: "struct", element: "sized" })).toEqual({ type: undefined })
  expect(along(fb, [field("inner"), field("X")], { fields: "composite", element: "sized" })).toEqual({ type: INT })
  expect(along(st, [field("arr"), index, field("x")], { fields: "struct", element: "sized" })).toEqual({ type: INT })
  expect(along(st, [field("open"), index], { fields: "struct", element: "sized" })).toEqual({ type: undefined })
  expect(along(st, [field("open"), index], { fields: "struct", element: "any" })).toEqual({ type: st })
})

test("typeAlong: visit sees each step on the type it is taken on, and stops the walk with its answer", () => {
  const seen: string[] = []
  const walked = typeAlong(lw, fb, [field("inner"), field("x")], { fields: "composite", element: "sized" }, (step, on, at) => {
    seen.push(`${at}:${step.kind === "field" ? step.name : step.kind}@${on?.kind}`)
    return on?.kind === "struct" ? "stopped at the struct" : undefined
  })
  expect(seen).toEqual(["0:inner@function_block", "1:x@struct"])
  expect(walked).toEqual({ stopped: "stopped at the struct" })
})

test("staticKey: root, slot and static path — a runtime index or a bit has none; the guard is not part of it", () => {
  const runtime: Access = { kind: "index", index: { kind: "load", place: { slot: 9, path: [], type: INT, span: undefined as never }, type: INT, span: undefined as never }, lower: 0n }
  const p = (path: Access[], extra: object = {}) => ({ slot: 2, path, type: INT, span: undefined as never, ...extra })
  expect(staticKey(p([field("Inner"), index]))).toBe("frame:2:INNER.[1]")
  expect(staticKey(p([field("x")], { root: "global" }))).toBe("global:2:X")
  expect(staticKey(p([runtime]))).toBeUndefined()
  expect(staticKey(p([], { guard: p([]) }))).toBe(staticKey(p([])))
  expect(staticPath(p([field("a"), index]))).toBe(true)
  expect(staticPath(p([{ kind: "bit", index: 0, of: INT }]))).toBe(false)
  expect(suffixOf(slot("io"), p([field("Inner"), index]))).toBe("io_2_Inner_1")
  expect(suffixOf(slot("io"), p([runtime]))).toBeUndefined()
})

test("sameStep and sameTarget: one field (any case), or one constant index of the same value and type", () => {
  const big: Access = { kind: "index", index: { kind: "const", value: 1n, type: INT, span: undefined as never }, lower: 0n }
  const num: Access = { kind: "index", index: { kind: "const", value: 1, type: INT, span: undefined as never }, lower: 0n }
  expect(sameStep(field("a"), field("A"))).toBe(true)
  expect(sameStep(big, index)).toBe(true)
  expect(sameStep(big, num)).toBe(false)
  expect(sameStep(field("a"), big)).toBe(false)
  const base = (path: Access[]) => ({ base: { slot: 1, path, type: INT, span: undefined as never } })
  expect(sameTarget(base([field("a"), big]), base([field("A"), index]))).toBe(true)
  expect(sameTarget(base([field("a")]), base([field("b")]))).toBe(false)
})
