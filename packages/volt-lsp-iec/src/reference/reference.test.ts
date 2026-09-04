import { test, expect } from "bun:test"
import { lookupReference, renderReferenceHover } from "./index.js"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { hover, type Document } from "../services/index.js"

test("reference: elementary type entry with range DERIVED from types/elementary", () => {
  const int = lookupReference("INT")
  expect(int?.kind).toBe("data-type")
  expect(int?.details).toContain("range -32768..32767") // straight from the elementary SSOT
  expect(lookupReference("time_of_day")?.name).toBe("TOD") // alias-aware
  expect(lookupReference("MOD")?.kind).toBe("operator")
  expect(lookupReference("SQRT")?.kind).toBe("standard-function")
  expect(lookupReference("NotARealThing")).toBeUndefined()
})

test("reference hover markdown includes the one-liner + details", () => {
  const md = renderReferenceHover(lookupReference("BYTE")!)
  expect(md).toContain("elementary type")
  expect(md).toContain("range 0..255")
})

test("hover falls back to the reference catalog for a built-in type", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const doc: Document = { uri: "u", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  // cursor on the `INT` type name (a built-in, not a user symbol)
  const h = hover(doc, project, src.indexOf(": INT") + 2)
  expect((h?.contents as { value: string }).value).toContain("elementary type")
})

// ─── conversion built-ins (found via the transpiler's corpus call census: 504 sites) ──────────────────────

test("the conversion operators resolve, derived from the elementary types rather than listed", () => {
  const real = lookupReference("INT_TO_REAL")
  expect(real?.oneLiner).toBe("Convert INT to REAL.")
  expect(real?.returnType).toBe("REAL")

  // the short form names only its target
  expect(lookupReference("TO_DINT")?.oneLiner).toBe("Convert the operand to DINT.")
  // case-insensitive, like every other catalog lookup
  expect(lookupReference("to_real")?.returnType).toBe("REAL")
  // an integer target carries its range, from `types/elementary` — the same numbers the checks use
  expect(lookupReference("TO_SINT")?.details).toBe("result range -128..127")
  // TRUNC stays hand-written: the catalog's wording names its real target (DINT), which the name does not
  expect(lookupReference("TRUNC")?.oneLiner).toBe("Truncate a REAL/LREAL toward zero to DINT.")
})

test("a conversion-shaped name with an unknown type is NOT described", () => {
  // `nameResolves` still lets these through (zero-FP), but the catalog must not invent a target it can't name
  expect(lookupReference("TO_MYSTRUCT")).toBeUndefined()
  expect(lookupReference("FOO_TO_BAR")).toBeUndefined()
  expect(lookupReference("INT_TO_NOPE")).toBeUndefined()
})
