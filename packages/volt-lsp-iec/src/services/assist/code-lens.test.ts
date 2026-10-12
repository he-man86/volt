/** Code lenses (`code-lens.ts`): a reference count above each named declaration. */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { codeLenses } from "./code-lens.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

// `Compute` (not `Add` — ADD is a reserved IEC operator keyword).
const SRC = `FUNCTION_BLOCK Lib
END_FUNCTION_BLOCK
METHOD Compute : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
END_METHOD
FUNCTION_BLOCK F
VAR
	lib : Lib;
	rx : INT;
END_VAR
rx := lib.Compute(1, 2);
END_FUNCTION_BLOCK`

test("code-lens: a reference count above each named declaration", () => {
  const { doc, project } = setup(SRC)
  const lenses = codeLenses([doc], project, doc)
  // Compute is called once (`lib.Compute(...)`) → 1 body reference.
  const compute = lenses.find((l) => l.range.start.line === 2)
  expect(compute?.command?.title).toBe("1 reference")
  // A type-only symbol (Lib, used solely as a declaration type) has 0 body references.
  expect(lenses.find((l) => l.range.start.line === 0)?.command?.title).toBe("0 references")
  expect(lenses.every((l) => /^\d+ references?$/.test(l.command?.title ?? ""))).toBe(true)
})
