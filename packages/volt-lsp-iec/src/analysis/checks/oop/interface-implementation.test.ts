/**
 * missing-interface-implementation — every path of the presence check + its conservative skips. The check
 * had only corpus coverage before; these pin the intent (esp. the abstract-chain skip added for pro2193's
 * Conveyor_SingleFB, where CODESYS `/build` accepted an interface method neither the FB nor its abstract
 * base chain provides).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** missing-interface-implementation messages for one source (codesys). */
const missing = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "missing-interface-implementation")
    .map((d) => d.message)
}

const IGO = `INTERFACE IGo\nMETHOD Go : BOOL\nEND_METHOD\nEND_INTERFACE\n`

test("a concrete FB missing an interface method is flagged (byte-identical wording)", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([
    "There is no implementation for method 'GO' defined in interface 'IGO'",
  ])
})

test("a concrete FB that provides the method is not flagged", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK\nMETHOD Go : BOOL\nGo := TRUE;\nEND_METHOD`)).toEqual([])
})

test("a method inherited from a concrete EXTENDS base is credited (not flagged)", () => {
  const src = `${IGO}FUNCTION_BLOCK Base\nEND_FUNCTION_BLOCK\nMETHOD Go : BOOL\nGo := TRUE;\nEND_METHOD\nFUNCTION_BLOCK F EXTENDS Base IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`
  expect(missing(src)).toEqual([])
})

// The abstract-chain skip (pro2193): CODESYS defers interface obligations through abstract hierarchies.
test("an FB extending an ABSTRACT base is not flagged even if the method is unprovided", () => {
  const src = `${IGO}FUNCTION_BLOCK ABSTRACT Base\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK F EXTENDS Base IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`
  expect(missing(src)).toEqual([])
})

test("an ABSTRACT FB itself is not flagged (may leave interface members abstract)", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK ABSTRACT F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("an unresolvable (library) base is not flagged — it could provide the member", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F EXTENDS SomeLibraryFB IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([])
})
