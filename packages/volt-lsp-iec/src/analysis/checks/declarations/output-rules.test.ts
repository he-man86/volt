/**
 * output-rules (C0222) — a VAR_OUTPUT declared as REFERENCE TO. Provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const out = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "output-reference-type")
    .map((d) => d.message)
}

test("a REFERENCE TO output is flagged; a REFERENCE TO local var is fine", () => {
  expect(out(`FUNCTION_BLOCK F\nVAR_OUTPUT r : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Outputs can't be of type 'REFERENCE TO'",
  ])
  expect(out(`FUNCTION_BLOCK F\nVAR r : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})
