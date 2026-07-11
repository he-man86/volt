/**
 * parse-errors — syntax errors now SHIP as diagnostics (previously discarded by design D3), from BOTH parser
 * streams: statement bodies AND declaration structure (unit headers, VAR sections, type decls). A malformed
 * statement or declaration is flagged at the offending token; valid code stays silent (the zero-FP contract the
 * corpus + conformance gates enforce). Grammar gaps the gate found (partial access, typed char literals) are
 * closed, so these valid CODESYS forms produce no diagnostic.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const syntaxErrors = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "syntax-error")
    .map((d) => d.message)
}

test("a missing THEN is surfaced precisely (not swallowed, not a cascade)", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest\n  x := 9;\nEND_IF\nEND_PROGRAM`)).toEqual([
    "expected THEN in IF, got identifier 'x'",
  ])
})

test("a missing FOR initializer is surfaced", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nFOR i TO 10 DO\n  ;\nEND_FOR\nEND_PROGRAM`).length).toBeGreaterThan(0)
})

test("valid ST produces NO syntax-error diagnostics (zero-FP contract)", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest THEN\n  x := 9;\nELSE\n  x := 0;\nEND_IF\nEND_PROGRAM`)).toEqual([])
  expect(syntaxErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nCASE i OF\n  1: i := 2;\n  2, 3: i := 4;\nELSE\n  i := 0;\nEND_CASE\nEND_PROGRAM`)).toEqual([])
})

test("declaration-structure errors surface precisely (the parser's decl stream, not just statements)", () => {
  // A VAR-section keyword inside a STRUCT — one precise error at the offending keyword (C0173).
  expect(syntaxErrors(`TYPE T :\nSTRUCT\n VAR_INPUT\n  m : INT;\n END_VAR\nEND_STRUCT\nEND_TYPE`)).toEqual([
    "'VAR_INPUT' not allowed in this place",
  ])
  // A declaration with no VAR block was SILENT before decl errors were surfaced — now it's flagged (C0212).
  expect(syntaxErrors(`PROGRAM P\ni : INT;\nEND_PROGRAM`).length).toBeGreaterThan(0)
})

test("valid declarations produce NO syntax-error diagnostics (decl zero-FP contract)", () => {
  expect(syntaxErrors(`TYPE T :\nSTRUCT\n  m : INT;\n  n : REAL;\nEND_STRUCT\nEND_TYPE`)).toEqual([])
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR_INPUT\n  a : INT;\nEND_VAR\nVAR\n  b : BOOL := TRUE;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("grammar-completion forms surface no false positive (gate regression guard)", () => {
  // partial variable access + typed char literal — valid CODESYS ST the gate caught our parser rejecting.
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR dw : DWORD; w : WORD; b : BYTE;\nEND_VAR\nw := dw.%W1;\nb := dw.%B3;\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR b : BYTE;\nEND_VAR\nb := UCHAR#'A';\nEND_FUNCTION_BLOCK`)).toEqual([])
})
