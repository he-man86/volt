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

const reinit = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "fb-reinit-shape")
    .map((d) => d.message)
}

test("C0566: an FB_ReInit with an input or a non-BOOL return is flagged; no-input BOOL is fine", () => {
  const msg =
    "The FB_ReInit method of a function block or struct must have no inputs and a return value of type BOOL. The FB_ReInit will not be called automatically!"
  expect(reinit(`METHOD FB_ReInit : BOOL\nVAR_INPUT\n input_var : INT;\nEND_VAR\nEND_METHOD`)).toEqual([msg])
  expect(reinit(`METHOD FB_ReInit : INT\nEND_METHOD`)).toEqual([msg]) // wrong return type
  expect(reinit(`METHOD FB_ReInit : BOOL\nEND_METHOD`)).toEqual([]) // correct shape
})
