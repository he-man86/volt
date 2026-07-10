/**
 * inout-initializer — C0441: a VAR_IN_OUT variable referenced in another declaration's initializer. A
 * VAR_IN_OUT used in a statement body (its normal use) is not flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "inout-in-initializer")
    .map((d) => d.message)
}

test("C0441: a VAR_IN_OUT referenced in an initializer is flagged", () => {
  expect(msgs(`FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR_OUTPUT\n b : INT := a;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
})

test("C0441: a VAR_IN_OUT used in the body (not an initializer) is not flagged", () => {
  expect(msgs(`FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n b : INT;\nEND_VAR\nb := a;\nEND_FUNCTION_BLOCK`)).toEqual([])
  // an unrelated initializer referencing a non-VAR_IN_OUT constant is fine
  expect(msgs(`FUNCTION_BLOCK POU\nVAR CONSTANT\n c : INT := 5;\nEND_VAR\nVAR\n b : INT := c;\nEND_VAR\nVAR_IN_OUT\n a : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})
