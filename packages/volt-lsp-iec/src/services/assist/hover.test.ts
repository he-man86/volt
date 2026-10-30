/**
 * Hover (`hover.ts`): a variable's reconstructed declaration and kind label, a unit's declaring keyword, the built-in
 * fallback in the project's dialect, the pragma hover, and an interface member. The built-in texts themselves are
 * `builtin-hover.test.ts`'s.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { hover, pragmaHover } from "./hover.js"
import { completion } from "./completion.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

const projectOf = (doc: Document) =>
  build.buildSymbolTable([{ uri: doc.uri, parseResult: doc.parseResult, source: doc.source }], [], "codesys")

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

test("hover: a variable shows its reconstructed declaration + kind label", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("rx : INT"))
  const value = (h?.contents as { value: string }).value
  expect(value).toContain("rx : INT")
  expect(value).toContain("_variable_")
})

test("hover: a named unit shows its declaring keyword", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("FUNCTION_BLOCK Lib") + "FUNCTION_BLOCK ".length)
  expect((h?.contents as { value: string }).value).toContain("FUNCTION_BLOCK Lib")
})

test("hover: each unit kind reconstructs its declaring keyword", () => {
  // Covers the declKeyword rendering for typeExpr-less symbols (program/interface/type/method/action/…).
  const src = `PROGRAM P
END_PROGRAM
INTERFACE I
END_INTERFACE
TYPE T : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK FB
END_FUNCTION_BLOCK
METHOD M
END_METHOD`
  const doc: Document = {
    uri: "file:///F.pou",
    source: src,
    parseResult: parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult: doc.parseResult, source: src }], [], "codesys")
  const kw = (needle: string, prefix: string) =>
    (hover(doc, project, src.indexOf(needle) + prefix.length)?.contents as { value: string } | undefined)?.value ?? ""
  expect(kw("PROGRAM P", "PROGRAM ")).toContain("PROGRAM P")
  expect(kw("INTERFACE I", "INTERFACE ")).toContain("INTERFACE I")
  expect(kw("TYPE T", "TYPE ")).toContain("TYPE T")
  expect(kw("METHOD M", "METHOD ")).toContain("METHOD M") // return-less method → declKeyword path
})

test("hover: a built-in type falls back to the built-in hover", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("rx : INT") + "rx : ".length)
  expect(h).toBeDefined()
  expect((h?.contents as { value: string }).value).toMatch(/INT/)
})

test("hover: a built-in the project's dialect does not have answers nothing (one dialect-aware path, builtinName)", () => {
  // `__POUNAME` and `__COMPARE_AND_SWAP` are CODESYS-only; `BOOL_TO_LDATE` / `LDATE_TO_DINT` name LDATE, no TwinCAT
  // type. The analysis reports each "not defined" on TwinCAT, so hover may not describe it as a built-in there.
  const names = ["__POUNAME", "__COMPARE_AND_SWAP", "BOOL_TO_LDATE", "LDATE_TO_DINT"]
  const src = `PROGRAM P\nVAR\n\tx : DINT;\nEND_VAR\n${names.map((n) => `x := ${n};`).join("\n")}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///P.pou", source: src, parseResult }
  const at = (n: string) => src.indexOf(`:= ${n}`) + 3
  const on = (dialect: "codesys" | "twincat") =>
    build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], dialect)
  const codesys = on("codesys")
  const twincat = on("twincat")
  expect(names.filter((n) => hover(doc, codesys, at(n)) === undefined)).toEqual([])
  expect(names.filter((n) => hover(doc, twincat, at(n)) !== undefined)).toEqual([])
})

test("hover: whitespace / unknown token yields nothing", () => {
  const { doc, project } = setup(SRC)
  expect(hover(doc, project, SRC.indexOf("VAR\n") - 1)).toBeUndefined()
})

test("pragma hover: an {attribute '<name>'} name describes the attribute", () => {
  const src = `{attribute 'qualified_only'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`
  const doc: Document = {
    uri: "file:///F.pou",
    source: src,
    parseResult: parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }
  const h = pragmaHover(doc, projectOf(doc), src.indexOf("qualified_only") + 2)
  expect((h?.contents as { value: string }).value).toMatch(/qualified_only[\s\S]*attribute/i)
})

test("pragma hover: a directive word describes the directive; an unknown one yields nothing", () => {
  const src = `FUNCTION_BLOCK F\nVAR x : INT; END_VAR\n{IF defined(FOO)}\nx := 1;\n{END_IF}\nEND_FUNCTION_BLOCK`
  const doc: Document = {
    uri: "file:///F.pou",
    source: src,
    parseResult: parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }
  const onIf = pragmaHover(doc, projectOf(doc), src.indexOf("{IF") + 1)
  expect((onIf?.contents as { value: string }).value).toMatch(/[Cc]onditional/)
  expect(pragmaHover(doc, projectOf(doc), src.indexOf("x : INT"))).toBeUndefined() // not a pragma
})

describe("through the services barrel", () => {
  function setup(src: string) {
    const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
    const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
    return { doc, project }
  }

  function at(src: string, needle: string, n = 1): number {
    let idx = -1
    for (let i = 0; i < n; i++) idx = src.indexOf(needle, idx + 1)
    return idx + 1
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

  test("hover shows the declaration line + kind", () => {
    const { doc, project } = setup(SRC)
    const h = hover(doc, project, at(SRC, "count", 1))
    expect(h?.contents).toMatchObject({ kind: "markdown" })
    const value = (h!.contents as { value: string }).value
    expect(value).toContain("count : INT")
    expect(value).toContain("_variable_")
  })

  test("hover↔completion parity: the kind label is identical (E.1)", () => {
    const { doc, project } = setup(SRC)
    const h = hover(doc, project, at(SRC, "count", 1))
    const value = (h!.contents as { value: string }).value
    const item = completion(doc, project, at(SRC, "count := 0", 1)).find((i) => i.label === "count")
    // hover renders `_<humanKind>_`; completion puts the same humanKind in `detail`.
    expect(value).toContain(`_${item!.detail}_`)
  })
})

describe("an interface-typed member (P1)", () => {
  /**
   * Interface-typed member access (P1). `drv : IDrive; drv.Spin(…)` must complete/hover/sig-help through the
   * interface's members. Before the `interface` Type kind, `resolveTypeExpr(IDrive)` yielded UNKNOWN → completion
   * fell back to scope symbols and hover on the member wrongly matched a builtin operator.
   */
  const SRC = `INTERFACE IDrive
METHOD Spin : BOOL
VAR_INPUT
    dist : INT;
END_VAR
END_METHOD
PROPERTY Pos : INT
END_INTERFACE
PROGRAM PLC_PRG
VAR
    drv : IDrive;
    rv : BOOL;
    n : INT;
END_VAR
rv := drv.Spin(10);
n := drv.Pos;
END_PROGRAM`

  const setup = () => {
    const parseResult = parseSource(SRC, { networkText: true, unicodeIdentifiers: false }, "codesys")
    const doc: Document = { uri: "file:///F.pou", source: SRC, parseResult }
    return { doc, project: build.buildSymbolTable([{ uri: doc.uri, parseResult, source: SRC }], [], "codesys") }
  }

  test("hover on an interface method shows the method, not a builtin operator", () => {
    const { doc, project } = setup()
    const value =
      (hover(doc, project, SRC.indexOf("drv.Spin") + 4) as { contents?: { value?: string } })?.contents?.value ?? ""
    expect(value).toContain("Spin")
    expect(value).not.toContain("MOVE")
  })
})
