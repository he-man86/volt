/**
 * The one field lookup of every layer (transpile-restructure 8.3 R6): lowering, the byte image and the Rust printer read
 * a field step through it.
 */
import { expect, test } from "bun:test"
import { elementaryRef, type Type } from "../../frontend/types/index.js"
import { fieldIn, fieldIndex, type IrLayout, type IrSlot, layoutField } from "./index.js"

const INT = elementaryRef("INT")
const slot = (name: string, type: Type = INT): IrSlot => ({ name, type, section: "VAR", init: 0n })

test("a field by name, whatever its case — or none", () => {
  const fields = [slot("Alpha"), slot("beta")]
  expect(fieldIn(fields, "ALPHA")?.name).toBe("Alpha")
  expect(fieldIn(fields, "Beta")?.name).toBe("beta")
  expect(fieldIn(fields, "gamma")).toBeUndefined()
  expect(fieldIn(undefined, "x")).toBeUndefined()
  expect(fieldIndex(fields, "BETA")).toBe(1)
  expect(fieldIndex(fields, "gamma")).toBe(-1)
  expect(fieldIndex(undefined, "x")).toBe(-1)
})

test("a layout's field: the layout by the type's upper-cased name, the field by its name", () => {
  const layouts = new Map<string, IrLayout>([["ST_B", { name: "ST_B", kind: "struct", fields: [slot("x")] }]])
  expect(layoutField(layouts, "st_b", "X")?.name).toBe("x")
  expect(layoutField(layouts, "ST_C", "x")).toBeUndefined()
})
