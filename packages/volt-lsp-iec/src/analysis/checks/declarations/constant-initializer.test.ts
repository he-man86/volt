/**
 * constant-initializer (C0228): a CONSTANT variable without an initializer is flagged; an initialized
 * constant and a non-constant var are not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const ci = (body: string): string[] => {
  const src = `FUNCTION_BLOCK FB\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "constant-no-initial-value")
    .map((d) => d.message)
}

test("a CONSTANT without an initializer is flagged; one with an initializer is not", () => {
  expect(ci(`VAR CONSTANT\nk : INT;\nok : INT := 5;\nEND_VAR`)).toEqual(["No initial value for constant variable 'k'"])
})

test("it is a WARNING, not an error (live-confirmed on the bakon-nano build)", () => {
  const src = `FUNCTION_BLOCK FB\nVAR CONSTANT\nk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const ds = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
    (d) => d.code === "constant-no-initial-value",
  )
  expect(ds.map((d) => d.severity)).toEqual(["warning"])
})

test("a non-constant variable without an initializer is not flagged", () => {
  expect(ci(`VAR\nx : INT;\nEND_VAR`)).toEqual([])
})
