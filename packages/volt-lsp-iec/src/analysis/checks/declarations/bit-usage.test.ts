/**
 * bit-usage: C0203/C0204 (BIT in a wrong container/block) + C0205 (POINTER TO BIT) + C0206 (ARRAY OF BIT).
 *
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const errs = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code.startsWith("bit-") || d.code === "pointer-to-bit")
    .map((d) => d.message)
}

test("C0203: a BIT var in a PROGRAM is flagged; in an FB VAR-block it is fine", () => {
  expect(errs(`PROGRAM P\nVAR b:BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual([
    "Only structures and function blocks can contain variables of type BIT",
  ])
  expect(errs(`FUNCTION_BLOCK F\nVAR b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("C0204: a BIT var in an FB VAR_IN_OUT block is flagged", () => {
  expect(errs(`FUNCTION_BLOCK F\nVAR_IN_OUT b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section",
  ])
})

test("C0205/C0206: POINTER TO BIT and ARRAY OF BIT are flagged anywhere", () => {
  expect(errs(`PROGRAM P\nVAR pt:POINTER TO BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual(["POINTER TO BIT is not allowed"])
  expect(errs(`PROGRAM P\nVAR a:ARRAY[1..2] OF BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual(["BIT is not allowed as base type of an array"])
})

test("a BIT struct field stays quiet (structs allow BIT)", () => {
  expect(errs(`TYPE S : STRUCT b:BIT; END_STRUCT END_TYPE`)).toEqual([])
})
