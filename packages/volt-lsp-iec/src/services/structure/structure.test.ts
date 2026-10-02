import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { documentSymbols, foldingRanges, selectionRange, semanticTokens, SEMANTIC_TOKEN_TYPES } from "./index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true })
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
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

const docOf = (src: string, uri = "file:///F.fb"): Document => ({ uri, source: src, parseResult: parseSource(src, { networkText: true }) })
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

test("semantic tokens: color network-text operand text (whole-doc pass covers graphical bodies)", () => {
  // A network text (LD) body's operands are ordinary lexer tokens, so the whole-document semantic pass colors them —
  // no network text-specific pass needed. Guards that graphical bodies produce valid tokens over their operand region.
  const src = `FUNCTION_BLOCK F
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  const { doc, project } = setup(src)
  const { data } = semanticTokens(doc, project)
  expect(data.length % 5).toBe(0)
  // a token lands on the `out` operand line inside the network (line index 6, 0-based)
  let line = 0
  const lines: number[] = []
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]! // deltaLine is cumulative in the LSP encoding
    lines.push(line)
  }
  expect(lines).toContain(6) // the `out := (a AND b);` operand line is tokenized
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

// Folding and selection are about the TEXT: a block in a conditional branch the vendor does not compile, or under a
// condition the LSP cannot decide (`defined (IsSimulationMode)`), is still text the editor shows (frontend-conformance
// 2.7 review: the compiled tree left those bodies with no fold and no selection range).
const CONDITIONAL = `FUNCTION_BLOCK F
VAR
	i : INT;
END_VAR
{IF defined (IsSimulationMode)}
IF i > 0 THEN
	i := 1;
END_IF
{ELSE}
WHILE i > 0 DO
	i := i - 1;
END_WHILE
{END_IF}
END_FUNCTION_BLOCK`

test("folding and selection reach every conditional branch, decided or not", () => {
  const { doc } = setup(CONDITIONAL)
  const lines = foldingRanges(doc).map((r) => `${r.startLine}-${r.endLine}`)
  expect(lines).toContain("5-7") // the IF statement of the undecided branch
  expect(lines).toContain("9-11") // the WHILE of the other
  const sel = selectionRange(doc, CONDITIONAL.indexOf("i - 1") + 1)
  let depth = 0
  for (let node = sel; node !== undefined; node = node.parent) depth += 1
  expect(depth).toBeGreaterThan(3) // token, expression, assignment, WHILE, … — not just the token and the unit
})
