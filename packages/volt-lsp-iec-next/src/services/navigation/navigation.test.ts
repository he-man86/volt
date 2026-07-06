import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import type { Document } from "../shared/index.js"
import { definition, typeDefinition, references, documentHighlights, prepareRename, rename } from "./index.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}

/** Byte offset just inside the `n`-th occurrence of `needle`. */
function at(src: string, needle: string, n = 1): number {
  let idx = -1
  for (let i = 0; i < n; i++) idx = src.indexOf(needle, idx + 1)
  return idx + 1
}

const FB = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := count + 1;
END_FUNCTION_BLOCK`

test("definition: a body usage lands on the declaration", () => {
  const { doc, project } = setup(FB)
  const fromUsage = definition(doc, project, at(FB, "count", 2)) // `count :=`
  const fromDecl = definition(doc, project, at(FB, "count", 1)) // the declaration
  expect(fromUsage).toBeDefined()
  expect(fromUsage).toEqual(fromDecl) // both resolve to the same declaring location
  expect(fromUsage?.range.start).toEqual({ line: 2, character: 1 }) // `\tcount` on line 3
})

test("references + rename cover every binding (decl + 2 uses)", () => {
  const { doc, project } = setup(FB)
  const refs = references([doc], project, doc, at(FB, "count", 2))
  expect(refs).toHaveLength(3) // declaration + `count :=` + `count + 1`
  const edit = rename([doc], project, doc, at(FB, "count", 2), "total")
  expect(Object.values(edit!.changes!)[0]).toHaveLength(3)
  expect(references([doc], project, doc, at(FB, "count", 2), false)).toHaveLength(2) // no declaration
})

test("document highlights return the in-document occurrences", () => {
  const { doc, project } = setup(FB)
  expect(documentHighlights(doc, project, at(FB, "count", 2))).toHaveLength(3)
})

test("prepareRename gives the identifier range; undefined off a symbol", () => {
  const { doc, project } = setup(FB)
  expect(prepareRename(doc, project, at(FB, "count", 2))).toBeDefined()
  expect(prepareRename(doc, project, at(FB, "END_VAR", 1))).toBeUndefined() // a keyword, not a symbol
})

const CHAIN = `FUNCTION_BLOCK FB_A
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR
	inst : FB_A;
END_VAR
inst.n := 1;
END_FUNCTION_BLOCK`

test("member-chain definition + type-definition", () => {
  const { doc, project } = setup(CHAIN)
  // definition on `inst.n` → n's declaration inside FB_A (offset on the `n` member)
  const nDef = definition(doc, project, CHAIN.indexOf("inst.n") + "inst.".length)
  expect(nDef?.range.start).toEqual({ line: 2, character: 1 }) // `\tn : INT` in FB_A
  // type-definition on `inst` → FB_A's declaration
  const tDef = typeDefinition(doc, project, at(CHAIN, "inst : FB_A", 1))
  expect(tDef?.range.start).toEqual({ line: 0, character: 15 }) // `FUNCTION_BLOCK FB_A`
})
