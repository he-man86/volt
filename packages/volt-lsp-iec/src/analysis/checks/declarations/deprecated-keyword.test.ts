/**
 * deprecated-keyword — C0098: the obsolete `FUNCTIONBLOCK` spelling. The modern `FUNCTION_BLOCK` is fine.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "deprecated-functionblock")
    .map((d) => d.message)
}

test("C0098: the deprecated FUNCTIONBLOCK keyword is flagged; FUNCTION_BLOCK is not", () => {
  expect(msgs(`FUNCTIONBLOCK FB\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    `The keyword "FUNCTIONBLOCK" is no longer supported. Use "FUNCTION_BLOCK" instead.`,
  ])
  expect(msgs(`FUNCTION_BLOCK FB\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})
