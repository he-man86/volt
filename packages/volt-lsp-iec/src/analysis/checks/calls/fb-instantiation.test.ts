/**
 * fb-instantiation (C0080) — a function block invoked by its type name instead of an instance.
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

test("a member reached through a TYPE name needs an instance too", () => {
  // silent before: only a direct `FB()` was checked, so `FB.Method()` said nothing (conformance
  // `cc2_fb_not_instantiated`).
  const src = `FUNCTION_BLOCK FB_plain\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Get : INT\nGet := n;\nEND_METHOD\n\nFUNCTION_BLOCK FB_user\nVAR\ntaken : INT;\nEND_VAR\ntaken := FB_plain.Get();\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "fb-not-instantiated")
    .map((d) => d.message)
  expect(msgs).toEqual(["Function block 'FB_plain' must be instantiated to be accessed"])
})

test("CALLING an interface by its type name says so twice; reaching into one says it once", () => {
  const src = `INTERFACE ITF_run\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_c\nVAR\nn : INT;\nEND_VAR\nITF_run();\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "interface-not-instantiated" || d.code === "invalid-call-target")
    .map((d) => d.message)
  expect(msgs).toEqual(["Interface 'ITF_run' must be instantiated to be accessed", "Cannot call object of type 'INTERFACE'"])
})
