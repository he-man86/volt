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
