/** Document symbols (`document-symbol.ts`): the file outline, members nested, a GVL named from its file. */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { documentSymbols } from "./index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

const SRC = `FUNCTION_BLOCK F
VAR
	i : INT;
	total : INT;
END_VAR
FOR i := 0 TO 10 DO
	total := total + i;
END_FOR
END_FUNCTION_BLOCK`

const docOf = (src: string, uri = "file:///F.pou"): Document => ({
  uri,
  source: src,
  parseResult: parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys"),
})

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

describe("through the services barrel", () => {
  function setup(src: string) {
    const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
    const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
    return { doc, project }
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

  test("document symbols: file outline with members nested", () => {
    const { doc } = setup(SRC)
    const syms = documentSymbols(doc)
    expect(syms.map((s) => s.name)).toEqual(["FB_A", "F"])
    expect(syms[1]?.children?.map((c) => c.name)).toEqual(["inst", "count"])
  })
})
