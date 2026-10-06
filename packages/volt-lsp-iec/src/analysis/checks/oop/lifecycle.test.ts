/**
 * fb-lifecycle-signature — `FB_Init`/`FB_Exit`/`FB_ReInit` with the wrong signature. Vendor-keyed wording;
 * had only conformance coverage. Pins the flag + the correct-signature quiet case + per-vendor wording.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const lifecycle = (src: string, vendor: Vendor): string[] => {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
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
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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

// analysis-conformance 3.7 (`oopb_fb_init_input_wrong_type`, `oopb_fb_exit_extra_input`, both vendors 2026-10-06): the
// required inputs are BOOL — an INT bInitRetains is the same refusal — and FB_Exit takes bInCopyCode ALONE: an input after
// it is refused, where FB_Init takes extra inputs (`oopb_fb_init_extra_input_first` refuses only their ORDER)
test("a required input of another type than BOOL is the same refusal (oopb_fb_init_input_wrong_type)", () => {
  const src = withInit("VAR_INPUT\n bInitRetains : INT;\n bInCopyCode : BOOL;\nEND_VAR")
  expect(lifecycle(src, "codesys")).toEqual([
    "The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL",
  ])
  expect(lifecycle(src, "twincat")).toEqual([
    "An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL.",
  ])
})

test("FB_Exit with an input after bInCopyCode is refused; FB_Init's extra input is not (oopb_fb_exit_extra_input)", () => {
  const exit = `FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nMETHOD FB_Exit : BOOL\nVAR_INPUT\n bInCopyCode : BOOL;\n extra : INT;\nEND_VAR\nEND_METHOD`
  expect(lifecycle(exit, "codesys")).toEqual([
    "The FB_Exit method of a function block or struct must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL.",
  ])
  expect(lifecycle(exit, "twincat")).toEqual(["An 'FB_Exit'-Method of a functionblock or struct needs an input 'bInCopyCode' of type BOOL."])
  expect(lifecycle(withInit("VAR_INPUT\n bInitRetains : BOOL;\n bInCopyCode : BOOL;\n extra : INT;\nEND_VAR"), "codesys")).toEqual([])
})
