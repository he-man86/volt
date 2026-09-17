/**
 * signature-name — the object's name vs the name in its signature. Measured on CODESYS SP21 (2026-09-17,
 * conformance `sn_*`): FUNCTION_BLOCK, FUNCTION, PROGRAM and DUT are held to it; an INTERFACE is not, even with
 * an FB implementing it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

const at = (uri: string, source: string, vendor: Vendor = "codesys"): string[] => {
  const parseResult = parseSource(source)
  const project = buildSymbolTable([{ uri, parseResult, source }])
  return computeSemanticDiagnostics({ parseResult, source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "signature-name-mismatch")
    .map((d) => d.message)
}
const MISMATCH = ["The name used in the signature is not identical to the object name"]

test("a POU whose signature names something other than its object", () => {
  expect(at("FB_Object.fb", `FUNCTION_BLOCK FB_Signature\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual(MISMATCH)
  expect(at("F_Object.fun", `FUNCTION F_Signature : INT\nF_Signature := 1;\nEND_FUNCTION`)).toEqual(MISMATCH)
  expect(at("PRG_Object.prg", `PROGRAM PRG_Signature\nVAR\nn : INT;\nEND_VAR\nEND_PROGRAM`)).toEqual(MISMATCH)
  expect(at("DUT_Object.struct", `TYPE DUT_Signature :\nSTRUCT\nx : INT;\nEND_STRUCT\nEND_TYPE`)).toEqual(MISMATCH)
})

test("an INTERFACE is exempt — measured with an FB implementing it, not merely unreferenced", () => {
  expect(at("ITF_Object.itf", `INTERFACE ITF_Signature\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE`)).toEqual([])
})

test("agreement, and case-only difference, are silent — IEC names are case-insensitive", () => {
  expect(at("FB_Same.fb", `FUNCTION_BLOCK FB_Same\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(at("FB_Casing.fb", `FUNCTION_BLOCK fb_CASING\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("a file packing SEVERAL items is not a workspace file, so it is skipped", () => {
  // A conformance fixture inlines its dependencies; the file is named after only one of them.
  expect(at("FB_One.fb", `FUNCTION_BLOCK FB_One\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_Two\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("TwinCAT is unmeasured, so the check stays silent there", () => {
  expect(at("FB_Object.fb", `FUNCTION_BLOCK FB_Signature\nEND_FUNCTION_BLOCK`, "twincat")).toEqual([])
})
