/** Selection ranges (`selection.ts`): token → expression → statement, outward. */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { selectionRange } from "./index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
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
