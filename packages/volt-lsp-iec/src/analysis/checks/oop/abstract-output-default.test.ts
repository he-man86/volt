/**
 * abstract-output-default — C0533: a VAR_OUTPUT initializer in an interface or explicitly-abstract method.
 * A concrete method's VAR_OUTPUT default (legitimately used) stays quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "abstract-output-default")
    .map((d) => d.message)
}

const MSG = "The default value for a VAR_OUTPUT is not used in abstract or interface methods"

test("C0533: an interface method's VAR_OUTPUT default is flagged", () => {
  expect(msgs(`INTERFACE ITF\nMETHOD METH : BOOL\nVAR_OUTPUT\n xOut : BOOL := TRUE;\nEND_VAR\nEND_METHOD\nEND_INTERFACE`)).toEqual([MSG])
})

test("C0533: an explicitly-ABSTRACT method's VAR_OUTPUT default is flagged", () => {
  expect(msgs(`FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\n\nMETHOD ABSTRACT M : BOOL\nVAR_OUTPUT\n o : INT := 5;\nEND_VAR\nEND_METHOD`)).toEqual([MSG])
})

test("a concrete method's VAR_OUTPUT default is not flagged", () => {
  expect(msgs(`FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\n\nMETHOD M : BOOL\nVAR_OUTPUT\n o : INT := 5;\nEND_VAR\no := 1;\nEND_METHOD`)).toEqual([])
})
