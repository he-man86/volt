import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { completion, documentSymbols, hover, type Document } from "./index.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}
function at(src: string, needle: string, n = 1): number {
  let idx = -1
  for (let i = 0; i < n; i++) idx = src.indexOf(needle, idx + 1)
  return idx + 1
}

const SRC = `FUNCTION_BLOCK FB_A
VAR
	speed : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR
	inst : FB_A;
	count : INT;
END_VAR
count := 0;
END_FUNCTION_BLOCK`

test("hover shows the declaration line + kind", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, at(SRC, "count", 1))
  expect(h?.contents).toMatchObject({ kind: "markdown" })
  const value = (h!.contents as { value: string }).value
  expect(value).toContain("count : INT")
  expect(value).toContain("_variable_")
})

test("completion: member access offers the base type's members", () => {
  // cursor right after `inst.` — synthesize by inserting a dot position
  const withDot = SRC.replace("count := 0;", "inst.;\ncount := 0;")
  const { doc: d2, project: p2 } = setup(withDot)
  const items = completion(d2, p2, withDot.indexOf("inst.") + "inst.".length)
  expect(items.map((i) => i.label)).toContain("speed")
})

test("completion: scope mode offers visible symbols + keywords", () => {
  const { doc, project } = setup(SRC)
  const items = completion(doc, project, at(SRC, "count := 0", 1))
  const labels = items.map((i) => i.label)
  expect(labels).toContain("count")
  expect(labels).toContain("inst")
  expect(labels).toContain("IF") // keyword
})

test("hover↔completion parity: the kind label is identical (E.1)", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, at(SRC, "count", 1))
  const value = (h!.contents as { value: string }).value
  const item = completion(doc, project, at(SRC, "count := 0", 1)).find((i) => i.label === "count")
  // hover renders `_<humanKind>_`; completion puts the same humanKind in `detail`.
  expect(value).toContain(`_${item!.detail}_`)
})

test("document symbols: file outline with members nested", () => {
  const { doc } = setup(SRC)
  const syms = documentSymbols(doc)
  expect(syms.map((s) => s.name)).toEqual(["FB_A", "F"])
  expect(syms[1]?.children?.map((c) => c.name)).toEqual(["inst", "count"])
})
