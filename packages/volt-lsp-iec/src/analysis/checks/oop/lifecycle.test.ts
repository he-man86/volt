/**
 * fb-lifecycle-signature — `FB_Init`/`FB_Exit`/`FB_ReInit` with the wrong signature. Vendor-keyed wording;
 * had only conformance coverage. Pins the flag + the correct-signature quiet case + per-vendor wording.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"

const lifecycle = (src: string, vendor: Vendor): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "fb-lifecycle-signature")
    .map((d) => d.message)
}

const withInit = (varInput: string) =>
  `FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\n${varInput}\nEND_METHOD`

test("a wrong FB_Init signature is flagged, vendor-keyed", () => {
  const src = withInit("") // missing the two required BOOL inputs
  expect(lifecycle(src, "codesys")).toEqual([
    "The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL",
  ])
  expect(lifecycle(src, "twincat")).toEqual([
    "An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL.",
  ])
})

test("a correct FB_Init signature is not flagged", () => {
  const src = withInit("VAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR")
  expect(lifecycle(src, "codesys")).toEqual([])
  expect(lifecycle(src, "twincat")).toEqual([])
})
