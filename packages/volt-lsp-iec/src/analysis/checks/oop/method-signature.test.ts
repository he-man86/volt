/**
 * method-signature — C0089 (FB method vs implemented interface method) and C0094/C0568 (override vs base FB
 * method). Conservative per-section parameter-count comparison: a count delta fires, an identical override is
 * quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string, code: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === code)
    .map((d) => d.message)
}

test("C0089: an FB method with a different param count than its interface method is flagged", () => {
  const src =
    `INTERFACE XY\nMETHOD METH1\nVAR_INPUT\n iPar : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK FB IMPLEMENTS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-interface")).toEqual([
    "Interface of overridden method 'METH1' of interface 'XY' doesn't match declaration",
  ])
})

test("C0094/C0568: an override with a different param count than the base method is flagged", () => {
  const src =
    `FUNCTION_BLOCK XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK XY2 EXTENDS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\n iPar : BOOL;\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-base")).toEqual([
    "Interface of overridden method 'METH1' of base 'XY' doesn't match declaration",
  ])
})

test("a matching override (same param count) is not flagged", () => {
  const src =
    `FUNCTION_BLOCK XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK XY2 EXTENDS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\n b : INT;\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-base")).toEqual([])
})
