/**
 * non-instantiable (C0177) — a variable declared with the type of a FUNCTION POU. Provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const ni = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "not-instantiable")
    .map((d) => d.message)
}

test("a variable of a FUNCTION type is flagged; FB / elementary types are fine", () => {
  expect(ni(`PROGRAM P\nVAR inst : POU;\nEND_VAR\nEND_PROGRAM\nFUNCTION POU : INT\nEND_FUNCTION`)).toEqual([
    "'POU' is of type 'FUNCTION' and cannot be instantiated",
  ])
  expect(ni(`PROGRAM P\nVAR inst : FB;\nEND_VAR\nEND_PROGRAM\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(ni(`PROGRAM P\nVAR i : INT;\nEND_VAR\nEND_PROGRAM`)).toEqual([])
})
