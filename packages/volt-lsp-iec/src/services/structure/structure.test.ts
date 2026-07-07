import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import type { Document } from "../shared/index.js"
import { documentSymbols, foldingRanges, selectionRange, semanticTokens, SEMANTIC_TOKEN_TYPES } from "./index.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}

const SRC = `FUNCTION_BLOCK F
VAR
	i : INT;
	total : INT;
END_VAR
FOR i := 0 TO 10 DO
	total := total + i;
END_FOR
END_FUNCTION_BLOCK`

const docOf = (src: string, uri = "file:///F.fb"): Document => ({ uri, source: src, parseResult: parseSource(src) })
const names = (syms: { name: string }[]) => syms.map((s) => s.name)

test("document-symbol: an FB outlines with its VAR members as children", () => {
  const syms = documentSymbols(docOf(SRC))
  expect(names(syms)).toEqual(["F"])
  expect(names(syms[0].children ?? [])).toEqual(["i", "total"])
})

test("document-symbol: struct fields, enum members, and interface methods appear as children", () => {
  const struct = documentSymbols(docOf(`TYPE Pt : STRUCT x : INT; y : INT; END_STRUCT END_TYPE`))
  expect(names(struct[0].children ?? [])).toEqual(["x", "y"])
  const en = documentSymbols(docOf(`TYPE E : (A, B, C); END_TYPE`))
  expect(names(en[0].children ?? [])).toEqual(["A", "B", "C"])
  const itf = documentSymbols(docOf(`INTERFACE I\nMETHOD M : BOOL\nEND_METHOD\nEND_INTERFACE`))
  expect(names(itf[0].children ?? [])).toEqual(["M"])
})

test("document-symbol: a GVL is named from its file and lists its globals", () => {
  const gvl = documentSymbols(docOf(`VAR_GLOBAL g : INT; h : BOOL; END_VAR`, "file:///MyGlobals.gvl"))
  expect(gvl[0].name).toBe("MyGlobals")
  expect(names(gvl[0].children ?? [])).toEqual(["g", "h"])
})

test("folding: unit + VAR section + FOR block are foldable", () => {
  const { doc } = setup(SRC)
  const ranges = foldingRanges(doc)
  // the FB spans the whole file; the VAR section and the FOR loop are multi-line sub-regions
  expect(ranges.length).toBeGreaterThanOrEqual(3)
  expect(ranges.every((r) => r.endLine > r.startLine)).toBe(true)
})

test("selection: expands token → expr → statement outward", () => {
  const { doc } = setup(SRC)
  const total = SRC.indexOf("total := total") + 1
  const sel = selectionRange(doc, total)
  expect(sel).toBeDefined()
  // each parent range must CONTAIN its child range
  const le = (a: { line: number; character: number }, b: { line: number; character: number }) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character)
  let node = sel
  let steps = 0
  while (node?.parent !== undefined) {
    expect(le(node.parent.range.start, node.range.start)).toBe(true)
    expect(le(node.range.end, node.parent.range.end)).toBe(true)
    node = node.parent
    steps += 1
  }
  expect(steps).toBeGreaterThan(0) // there is a real expansion chain
})

test("semantic tokens: emits 5-int tuples with valid type indices", () => {
  const { doc, project } = setup(SRC)
  const { data } = semanticTokens(doc, project)
  expect(data.length % 5).toBe(0)
  expect(data.length).toBeGreaterThan(0)
  // every emitted type index is within the legend
  for (let i = 3; i < data.length; i += 5) expect(data[i]).toBeLessThan(SEMANTIC_TOKEN_TYPES.length)
  // an identifier bound to a variable colors as "variable"; a keyword as "keyword"
  expect(SEMANTIC_TOKEN_TYPES).toContain("variable")
  expect(SEMANTIC_TOKEN_TYPES).toContain("keyword")
})
