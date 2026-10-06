/**
 * output-rules (C0222) — a VAR_OUTPUT declared as REFERENCE TO.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const out = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "output-reference-type")
    .map((d) => d.message)
}

test("a REFERENCE TO output is flagged; a REFERENCE TO local var is fine", () => {
  expect(out(`FUNCTION_BLOCK F\nVAR_OUTPUT rv : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Outputs can't be of type REFERENCE TO",
  ])
  expect(out(`FUNCTION_BLOCK F\nVAR rv : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})
