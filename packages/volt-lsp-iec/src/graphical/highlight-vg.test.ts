/**
 * document-highlight over a VG (graphical) body (P2). The ST-only `documentHighlights` skips graphical bodies,
 * so highlighting an operand used in a NETWORK missed its in-network uses. `documentHighlightsAnywhere` reuses
 * the VG-aware `allReferences`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { documentHighlightsAnywhere } from "./vg-services.js"

const LD = `FUNCTION_BLOCK FB_LD
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
NETWORK 0 LD
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("highlighting a VG operand includes its declaration AND its in-network use", () => {
  const parseResult = parseSource(LD)
  const doc = { uri: "file:///F.fb", source: LD, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: LD }])
  // Cursor on `a` inside the network `out := (a AND b)`.
  const ranges = documentHighlightsAnywhere(doc, project, LD.indexOf("(a AND") + 1)
  expect(ranges).toBeDefined()
  expect(ranges!.length).toBe(2) // the `a : BOOL` declaration + the network operand use
})
