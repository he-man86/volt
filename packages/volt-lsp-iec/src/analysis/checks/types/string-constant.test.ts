/**
 * string-constant-too-long (C0198). A string literal longer than its declared STRING(n).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const sc = (decls: string): string[] => {
  const src = `PROGRAM P\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "string-constant-too-long")
    .map((d) => d.message)
}

test("an over-length string literal is flagged", () => {
  expect(sc(`  str : STRING(4) := '12345';`)).toEqual(["String constant ''...' too long for destination type 'STRING(4)'"])
})

test("exact/short literals and sizeless STRING stay quiet (0-FP)", () => {
  expect(sc(`  str : STRING(4) := '1234';`)).toEqual([]) // exact
  expect(sc(`  str : STRING(4) := 'ab';`)).toEqual([]) // short
  expect(sc(`  str : STRING := '12345';`)).toEqual([]) // no declared size
})

test("IEC `$` escapes count as one character (0-FP — was a corpus FP)", () => {
  expect(sc(`  str : STRING(1) := '$T';`)).toEqual([]) // $T = tab = 1 char
  expect(sc(`  str : STRING(2) := '$$$'';`)).toEqual([]) // $$ + $' = 2 chars
  expect(sc(`  str : STRING(1) := '$0D';`)).toEqual([]) // $0D = hex = 1 char
})
