/**
 * fb-instantiation (C0080) — a function block invoked by its type name instead of an instance. Provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const fb = (body: string): string[] => {
  const src = `PROGRAM P\nVAR inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "fb-not-instantiated")
    .map((d) => d.message)
}

test("calling an FB by its type name is flagged; calling an instance is fine", () => {
  expect(fb(`FB();`)).toEqual(["Function block 'FB' must be instantiated to be accessed"])
  expect(fb(`inst();`)).toEqual([])
})

test("C0199: calling an interface by its type name is flagged", () => {
  const src = `FUNCTION_BLOCK F\nVAR\nEND_VAR\nITF();\nEND_FUNCTION_BLOCK\nINTERFACE ITF\nEND_INTERFACE`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "interface-not-instantiated")
    .map((d) => d.message)
  expect(msgs).toEqual(["Interface 'ITF' must be instantiated to be accessed"])
})
