/**
 * Folding (`folding.ts`): a unit, its VAR sections and its blocks fold, every conditional branch (with selection, which
 * walks the same branches), and a body stated `IMPLEMENTATION LD` folds per NETWORK.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { selectionRange } from "./index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"
import { foldingRanges } from "./folding.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true }, "codesys")
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

test("folding: unit + VAR section + FOR block are foldable", () => {
  const { doc } = setup(SRC)
  const ranges = foldingRanges(doc)
  // the FB spans the whole file; the VAR section and the FOR loop are multi-line sub-regions
  expect(ranges.length).toBeGreaterThanOrEqual(3)
  expect(ranges.every((r) => r.endLine > r.startLine)).toBe(true)
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

describe("the implementation keyword", () => {
  /**
   * The implementation keyword in the structure services (openspec `implementation-keyword`): `IMPLEMENTATION` and the
   * language it states colour as keywords, and a body stated `LD`/`FBD` folds per NETWORK like any graphical body.
   */
  const ST_FB = `FUNCTION_BLOCK F
VAR
\tx : INT;
END_VAR
IMPLEMENTATION ST
x := 1;
END_FUNCTION_BLOCK
`

  const LD_FB = `FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
NETWORK
out := (a OR b);
END_NETWORK
END_FUNCTION_BLOCK`

  test("folding: each NETWORK of a body stated IMPLEMENTATION LD is a foldable range", () => {
    const folds = foldingRanges({
      uri: "file:///F.pou",
      source: LD_FB,
      parseResult: parseSource(LD_FB, { networkText: true }, "codesys"),
    })
    const networks = folds.filter((f) => f.startLine >= 5)
    expect(networks.map((f) => [f.startLine, f.endLine])).toEqual([
      [5, 7],
      [8, 10],
    ])
  })

  test("folding: an ST body's keyword line does not break the unit's fold", () => {
    const folds = foldingRanges({
      uri: "file:///F.pou",
      source: ST_FB,
      parseResult: parseSource(ST_FB, { networkText: true }, "codesys"),
    })
    expect(folds.some((f) => f.startLine === 0 && f.endLine >= 5)).toBe(true)
  })
})
