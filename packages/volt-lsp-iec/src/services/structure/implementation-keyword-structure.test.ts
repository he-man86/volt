/**
 * The implementation keyword in the structure services (openspec `implementation-keyword`): `IMPLEMENTATION` and the
 * language it states colour as keywords, and a body stated `LD`/`FBD` folds per NETWORK like any graphical body.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { SEMANTIC_TOKEN_TYPES, semanticTokensData } from "./semantic-tokens.js"
import { foldingRanges } from "./folding.js"

/** `line:text → semantic type` for every token on `lines`. */
function typesOn(src: string, lines: readonly number[]): Record<string, string> {
  const doc = { uri: "file:///F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
  const project = build.buildSymbolTable([{ uri: doc.uri, source: src, parseResult: doc.parseResult }])
  const data = semanticTokensData(doc as never, project)
  const text = src.split("\n")
  const out: Record<string, string> = {}
  let line = 0
  let ch = 0
  for (let i = 0; i < data.length; i += 5) {
    line += data[i]!
    if (data[i]! > 0) ch = 0
    ch += data[i + 1]!
    if (lines.includes(line))
      out[`${line}:${text[line]!.slice(ch, ch + data[i + 2]!)}`] = SEMANTIC_TOKEN_TYPES[data[i + 3]!]!
  }
  return out
}

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

test("semantic tokens: IMPLEMENTATION and its stated language colour as keywords", () => {
  expect(typesOn(ST_FB, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:ST": "keyword" })
  expect(typesOn(LD_FB, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:LD": "keyword" })
  expect(typesOn(LD_FB.replace("IMPLEMENTATION LD", "IMPLEMENTATION FBD"), [4])).toEqual({
    "4:IMPLEMENTATION": "keyword",
    "4:FBD": "keyword",
  })
})

test("semantic tokens: the body after IMPLEMENTATION ST still colours as ST", () => {
  expect(typesOn(ST_FB, [5])["5:x"]).toBe("variable")
})

test("folding: each NETWORK of a body stated IMPLEMENTATION LD is a foldable range", () => {
  const folds = foldingRanges({ uri: "file:///F.pou", source: LD_FB, parseResult: parseSource(LD_FB, { networkText: true }) })
  const networks = folds.filter((f) => f.startLine >= 5)
  expect(networks.map((f) => [f.startLine, f.endLine])).toEqual([
    [5, 7],
    [8, 10],
  ])
})

test("folding: an ST body's keyword line does not break the unit's fold", () => {
  const folds = foldingRanges({ uri: "file:///F.pou", source: ST_FB, parseResult: parseSource(ST_FB, { networkText: true }) })
  expect(folds.some((f) => f.startLine === 0 && f.endLine >= 5)).toBe(true)
})

test("semantic tokens: an UNSUPPORTED line colours every word it states, and a look-alike in a comment none", () => {
  const ro = ST_FB.replace("IMPLEMENTATION ST\nx := 1;", "IMPLEMENTATION LD UNSUPPORTED\n")
  expect(typesOn(ro, [4])).toEqual({ "4:IMPLEMENTATION": "keyword", "4:LD": "keyword", "4:UNSUPPORTED": "keyword" })
  const commented = ST_FB.replace("END_VAR\n", "END_VAR\n// IMPLEMENTATION LD\n")
  expect(typesOn(commented, [4])).toEqual({ "4:// IMPLEMENTATION LD": "comment" })
})
