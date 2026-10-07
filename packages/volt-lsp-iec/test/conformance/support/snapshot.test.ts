import { describe, expect, test } from "bun:test"
import { elementaryType, elementaryTypeRef, type Type } from "../../../src/frontend/types/index.js"
import { emitRust, lowerSource } from "../../../src/transpile/index.js"
import { HARNESS_LOOP_GUARD } from "./transpile-confidence.js"
import { canonical, compareSnapshots, firstDifference, LAYERS, parseLayers, rustLayer, type FixtureSnapshot } from "./snapshot.js"

const span = { start: 0, end: 4, startLine: 3, startCol: 2, endLine: 3, endCol: 6 }

describe("the canonical IR", () => {
  test("keys are sorted, a Type is rendered, a span is line:col-line:col, a bigint and a NaN are tagged", () => {
    const text = canonical({ z: 1n, type: elementaryTypeRef(elementaryType("DINT")!), a: Number.NaN, span, kind: "const" })
    expect(JSON.parse(text)).toEqual({ a: "#NaN", kind: "const", span: "#span 3:2-3:6", type: "#type DINT", z: "#1n" })
  })

  test("negative zero and the infinities keep their sign", () => {
    expect(JSON.parse(canonical([-0, 0, Infinity, -Infinity]))).toEqual(["#-0", 0, "#Infinity", "#-Infinity"])
  })

  test("a bit access's `of` is a Type too; a field named like a type kind elsewhere is data", () => {
    const text = canonical({ path: [{ kind: "bit", index: 3, of: elementaryTypeRef(elementaryType("BYTE")!) }], layouts: [{ kind: "struct", name: "S" }] })
    expect(JSON.parse(text)).toEqual({ layouts: [{ kind: "struct", name: "S" }], path: [{ index: 3, kind: "bit", of: "#type BYTE" }] })
  })

  test("a Type's facts the backends read are part of it, not only its rendered name (review 0a)", () => {
    const STR = elementaryType("STRING")!
    const INT = elementaryTypeRef(elementaryType("INT")!)
    const str = (length: number): Type => ({ kind: "elementary", name: "STRING", elem: STR, length, lengthText: "cLen" })
    // a folded capacity behind a named length
    expect(canonical({ type: str(10) })).not.toBe(canonical({ type: str(80) }))
    // a capacity the scope cannot fold
    expect(canonical({ type: { ...str(80), unfoldedLength: true } })).not.toBe(canonical({ type: str(80) }))
    // an enum's base, a union, an array's folded bounds (also under an element and a target)
    expect(canonical({ type: { kind: "enum", name: "E", base: INT } })).not.toBe(canonical({ type: { kind: "enum", name: "E" } }))
    expect(canonical({ of: { kind: "struct", name: "U", union: true } })).not.toBe(canonical({ of: { kind: "struct", name: "U" } }))
    const dims = [{ lower: { kind: "name", name: "N" }, upper: { kind: "name", name: "M" } }] as never
    const arr = (upper: bigint, element: Type = INT): Type => ({ kind: "array", element, dims, bounds: [{ lower: 1n, upper }] })
    expect(canonical({ type: arr(5n) })).not.toBe(canonical({ type: arr(6n) }))
    expect(canonical({ type: arr(5n, str(10)) })).not.toBe(canonical({ type: arr(5n, str(80)) }))
    expect(canonical({ type: { kind: "pointer", target: str(10) } })).not.toBe(canonical({ type: { kind: "pointer", target: str(80) } }))
    // a subrange
    const sub = (upper: bigint): Type => ({ ...INT, subrange: { lower: 0n, upper } })
    expect(canonical({ type: sub(10n) })).not.toBe(canonical({ type: sub(11n) }))
  })

  test("a reference cycle is refused by name, never followed", () => {
    const node: Record<string, unknown> = { kind: "loop" }
    node.self = node
    expect(() => canonical({ body: [node] })).toThrow(/cycle at \$\.body\[0\]\.self/)
  })

  test("one value per line, so a difference names its line", () => {
    expect(canonical({ a: 1, b: [2, 3] }).split("\n").length).toBeGreaterThan(3)
  })
})

describe("comparing two snapshots", () => {
  const base = new Map<string, FixtureSnapshot>([
    ["fx_a", { ir: "x\ny", rust: "fn a() {}\nlet v = 1u8;", outputs: "o", edge: "agree" }],
    ["fx_b", { ir: "q", rust: "r", outputs: "o", edge: "agree" }],
  ])

  test("an unchanged tree is identical", () => {
    expect(compareSnapshots(base, new Map(base), LAYERS)).toEqual([])
  })

  test("a one-character change to one emitted literal is reported with its fixture name, layer and line", () => {
    const after = new Map(base)
    after.set("fx_a", { ...base.get("fx_a")!, rust: "fn a() {}\nlet v = 2u8;" })
    const report = compareSnapshots(base, after, LAYERS)
    expect(report).toHaveLength(1)
    expect(report[0]).toContain("fx_a")
    expect(report[0]).toContain("rust line 2")
    expect(report[0]).toContain("let v = 1u8;")
    expect(report[0]).toContain("let v = 2u8;")
  })

  test("only the first difference per fixture, in layer order", () => {
    const d = firstDifference({ ir: "a", rust: "b" }, { ir: "A", rust: "B" }, LAYERS)
    expect(d).toContain("ir line 1")
    expect(d).not.toContain("rust")
  })

  test("a fixture that stops or starts being snapshotted is reported, and a layer outside --layers is not compared", () => {
    const after = new Map<string, FixtureSnapshot>([["fx_a", { ...base.get("fx_a")!, ir: "changed" }], ["fx_c", { ir: "n", edge: "agree" }]])
    const report = compareSnapshots(base, after, ["edge"])
    expect(report).toEqual(["fx_b: in the baseline, not in this snapshot", "fx_c: not in the baseline"])
  })

  test("a fixture with none of the requested layers equals one the stored set has no line for (review 0a: S-out)", () => {
    // a fixture that does not lower has only `ir`: a store of `outputs,edge` writes no line for it, a take gives `{}`
    const before = new Map([["fx_a", base.get("fx_a")!]])
    const after = new Map([["fx_a", base.get("fx_a")!], ["fx_refused", {}]])
    expect(compareSnapshots(before, after, ["outputs", "edge"])).toEqual([])
    expect(compareSnapshots(after, before, ["outputs", "edge"])).toEqual([])
    // …and one that only has a layer outside the request
    expect(compareSnapshots(before, new Map([...after, ["fx_ir_only", { ir: "refused" }]]), ["outputs", "edge"])).toEqual([])
    // a fixture that stopped lowering still differs in a requested layer
    expect(compareSnapshots(before, new Map([["fx_a", { ir: "refused" }]]), ["outputs", "edge"])).toEqual([
      "fx_a: outputs: in the baseline, not in this snapshot",
    ])
  })

  test("a layer missing on one side is a difference (a fixture that stopped lowering keeps only its ir)", () => {
    expect(firstDifference({ ir: "a", rust: "r" }, { ir: "a" }, LAYERS)).toContain("rust: in the baseline, not in this snapshot")
  })

  test("--layers refuses a layer that does not exist", () => {
    expect(parseLayers("ir,outputs")).toEqual(["ir", "outputs"])
    expect(() => parseLayers("ir,emit")).toThrow(/no layer 'emit'/)
  })
})

describe("the rust layer", () => {
  test("holds the emission a user gets (no loop guard) beside the harness's (review 0a)", () => {
    const { pou } = lowerSource(
      "PROGRAM P\nVAR i : INT; n : INT; END_VAR\nWHILE i < 10 DO i := i + 1; END_WHILE\nFOR n := 1 TO 3 DO i := i + n; END_FOR\nEND_PROGRAM\n",
    )
    const text = rustLayer(pou!)
    expect(text).toContain(emitRust(pou!).code)
    expect(text).toContain(emitRust(pou!, { loopGuard: HARNESS_LOOP_GUARD }).code)
    expect(emitRust(pou!).code).not.toBe(emitRust(pou!, { loopGuard: HARNESS_LOOP_GUARD }).code)
  })
})
