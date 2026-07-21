/**
 * this-super-context (C0045 THIS / C0122 SUPER) — used in a PROGRAM/FUNCTION where they're invalid.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const errs = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "this-not-allowed" || d.code === "super-not-allowed")
    .map((d) => d.message)
}

test("THIS/SUPER in a PROGRAM are flagged; in a FUNCTION_BLOCK they are fine", () => {
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nTHIS^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression THIS is not allowed in this context"])
  expect(errs(`PROGRAM P\nVAR t:INT;\nEND_VAR\nSUPER^.t := 1;\nEND_PROGRAM`)).toEqual(["Expression SUPER is not allowed in this context"])
  expect(errs(`FUNCTION_BLOCK F\nVAR t:INT;\nEND_VAR\nTHIS^.t := 1;\nEND_FUNCTION_BLOCK`)).toEqual([])
})
