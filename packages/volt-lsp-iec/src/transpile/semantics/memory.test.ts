/** `semantics/memory.ts` against its case table (`memory.cases.ts`), and the place rewrite every reader shares. */
import { describe, expect, test } from "bun:test"
import { elementaryRef, type Type } from "../../frontend/types/index.js"
import type { IrLayout, Place } from "../ir/index.js"
import { IecFault } from "./faults.js"
import { CASE_IMAGE, MEMORY_CASES, MEMORY_INTERPRETER_DIVERGENCES, type MemoryInput } from "./memory.cases.js"
import { ADDRESS, BASE_FIELD, IMAGE_BASE, indexAddress, Memory, toImage } from "./memory.js"

const NO_LAYOUTS: ReadonlyMap<string, IrLayout> = new Map()

/** A loaded value as the cases print it: a REAL or LREAL by its bits in hex, anything else as itself. */
function printed(v: unknown, type: string): string {
  if (type === "REAL" || type === "LREAL") {
    const view = new DataView(new ArrayBuffer(8))
    if (type === "REAL") view.setFloat32(0, v as number)
    else view.setFloat64(0, v as number)
    return type === "REAL" ? view.getUint32(0).toString(16) : view.getBigUint64(0).toString(16)
  }
  return String(v)
}

/** One case run on a fresh image: its stores, then its read — or the fault it stopped on. */
function run(input: MemoryInput): string {
  const memory = new Memory({ ...CASE_IMAGE, bytes: [], regions: CASE_IMAGE.regions.map(([s, e]) => [s, e] as const) })
  try {
    for (const s of input.stores) memory.store(IMAGE_BASE + BigInt(s.at), elementaryRef(s.type), s.value, NO_LAYOUTS)
    const read = input.read
    if ("order" in read) return String(memory.order(IMAGE_BASE + BigInt(read.order[0]), IMAGE_BASE + BigInt(read.order[1])))
    return printed(memory.load(IMAGE_BASE + BigInt(read.at), elementaryRef(read.load), NO_LAYOUTS), read.load)
  } catch (e) {
    if (e instanceof IecFault) return `fault: ${e.kind}`
    throw e
  }
}

describe("the byte image's cases", () => {
  for (const [rule, cases] of Object.entries(MEMORY_CASES))
    describe(rule, () => {
      for (const c of cases) {
        const why = MEMORY_INTERPRETER_DIVERGENCES[c.name]
        // a known divergence runs as an expected failure: it fails the suite the day it starts to agree
        if (why !== undefined) test(`${c.name} — diverges: ${why}`, () => expect(run(c.input)).not.toBe(c.expected))
        else test(c.name, () => expect(run(c.input)).toBe(c.expected))
      }
    })
})

describe("addresses", () => {
  test("NULL faults as a null dereference, before any region is asked", () => {
    expect(() => new Memory(undefined).offset(0n, 1)).toThrow("dereference of a null pointer")
  })
  test("an index step is checked against its bounds, then moves by whole elements", () => {
    expect(indexAddress(IMAGE_BASE, 3n, 1n, 4, 2)).toBe(IMAGE_BASE + 4n)
    expect(() => indexAddress(IMAGE_BASE, 5n, 1n, 4, 2)).toThrow("array index 5 is outside its bounds")
    expect(() => indexAddress(IMAGE_BASE, 0n, 1n, 4, 2)).toThrow("array index 0 is outside its bounds")
  })
})

describe("toImage — one rewrite for lowering, the runner and the Rust harness", () => {
  const INT = elementaryRef("INT")
  const arr: Type = { kind: "array", element: INT, bounds: [{ lower: 1n, upper: 4n }], dims: [{}] } as unknown as Type
  const fb: Type = { kind: "function_block", name: "FB" } as Type
  const layouts = new Map<string, IrLayout>([
    ["FB", { name: "FB", kind: "function_block", fields: [{ name: "kept", type: INT, section: "VAR", init: 0n }, { name: "a", type: arr, section: "VAR", init: 0n, image: 10 }, { name: BASE_FIELD, type: ADDRESS, section: "temp", init: 0n }] }],
  ])
  const span = { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  const i: Place = { slot: 3, path: [], type: INT, span }
  const index = { kind: "load" as const, place: i, type: INT, span }

  test("a slot the image holds is its address, every step after it folded", () => {
    const place: Place = { slot: 0, path: [{ kind: "index", index, lower: 1n, length: 4 }], type: INT, span }
    const image = toImage(place, { type: arr, address: 4294967300 }, layouts)
    expect(image).toEqual({ slot: 0, root: "image", at: { kind: "const", value: 4294967300n, type: ADDRESS, span }, path: [{ kind: "index", index, lower: 1n, length: 4, size: 2 }], type: INT, span })
  })
  test("a field of an instance in the image is its __base plus the field's offset", () => {
    const place: Place = { slot: 2, path: [{ kind: "field", name: "a" }, { kind: "index", index, lower: 1n, length: 4 }], type: INT, span }
    const image = toImage(place, { type: fb }, layouts)
    expect(image.root).toBe("image")
    expect(image.at).toEqual({
      kind: "binary",
      op: "add",
      left: { kind: "load", place: { slot: 2, path: [{ kind: "field", name: BASE_FIELD }], type: ADDRESS, span }, type: ADDRESS, span },
      right: { kind: "const", value: 10n, type: ADDRESS, span },
      type: ADDRESS,
      span,
    })
  })
  test("a place the image does not hold comes back as it was", () => {
    const place: Place = { slot: 2, path: [{ kind: "field", name: "kept" }], type: INT, span }
    expect(toImage(place, { type: fb }, layouts)).toBe(place)
  })
})
