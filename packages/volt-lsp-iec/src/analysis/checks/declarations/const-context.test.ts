/**
 * constant-context: C0161 (non-constant array bound) + C0227 (non-constant VAR CONSTANT init). Both via
 * `constancyOf`, so enum members / VAR CONSTANT stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const run =
  (code: string) =>
  (body: string): string[] => {
    const src = `PROGRAM P\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const bound = run("array-bound-non-const")
const cinit = run("const-init-non-const")
const dflt = run("default-not-constant")

test("C0161: a variable array bound is flagged; literals and constants are not", () => {
  expect(bound(`VAR\n i:INT:=3;\n a:ARRAY[1..i] OF INT;\nEND_VAR`)).toEqual(["Border 'i' of array is no constant value"])
  expect(bound(`VAR CONSTANT K:INT:=3; END_VAR\nVAR a:ARRAY[1..K] OF INT; END_VAR`)).toEqual([]) // VAR CONSTANT bound
  expect(bound(`VAR a:ARRAY[1..10] OF INT; END_VAR`)).toEqual([]) // literal bound
})

test("C0227: a VAR CONSTANT initialized from a variable is flagged; constant inits are not", () => {
  expect(cinit(`VAR i:INT; END_VAR\nVAR CONSTANT k:INT:=i; END_VAR`)).toEqual([
    "Initialisation of constant variable 'k' not constant",
  ])
  expect(cinit(`VAR CONSTANT k:INT:=5; END_VAR`)).toEqual([]) // literal init
})

test("C0526: a VAR_INPUT default that is a mutable variable is flagged; a constant one is not", () => {
  expect(dflt(`VAR i:INT; END_VAR\nVAR_INPUT p:INT:=i; END_VAR`)).toEqual(["Default value is not constant"])
  expect(dflt(`VAR_INPUT p:INT:=5; END_VAR`)).toEqual([]) // literal default
})
