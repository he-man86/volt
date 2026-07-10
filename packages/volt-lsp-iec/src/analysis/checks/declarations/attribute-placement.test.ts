/**
 * attribute-placement — C0550: `{attribute 'pack_mode'}` on a FUNCTION or METHOD. Fires per offending POU;
 * a pack_mode on a struct (its legal home) and other attributes on a FUNCTION stay silent.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "pack-mode-not-allowed")
    .map((d) => d.message)
}

test("pack_mode on a METHOD and a FUNCTION are both flagged, kind-specific", () => {
  const src =
    `{attribute 'pack_mode' := '2'}\nMETHOD METH : INT\nVAR_INPUT\nEND_VAR\nEND_METHOD\n\n` +
    `{attribute 'pack_mode' := '1'}\nFUNCTION FunPacked : DINT\nVAR_INPUT\n by1 : BYTE;\nEND_VAR\nEND_FUNCTION`
  expect(msgs(src)).toEqual([
    "Attribute 'pack_mode' not allowed for 'METHOD'",
    "Attribute 'pack_mode' not allowed for 'FUNCTION'",
  ])
})

test("pack_mode on a struct (its legal home) is not flagged", () => {
  expect(msgs(`{attribute 'pack_mode' := '1'}\nTYPE S : STRUCT\n a : BYTE;\nEND_STRUCT\nEND_TYPE`)).toEqual([])
})

test("a different attribute on a FUNCTION is not flagged", () => {
  expect(msgs(`{attribute 'monitoring' := 'variable'}\nFUNCTION F : INT\nEND_FUNCTION`)).toEqual([])
})
