/** Inlay hints (`inlay-hints.ts`): a parameter-name hint before each positional call argument. */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { inlayHints } from "./inlay-hints.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
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

test("inlay-hints: parameter-name hints before positional call args", () => {
  const { doc, project } = setup(SRC)
  const hints = inlayHints(doc, project, 0, SRC.length)
  expect(hints.map((h) => h.label)).toEqual(["a:", "b:"])
})
