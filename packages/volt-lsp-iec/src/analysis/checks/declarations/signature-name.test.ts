/**
 * signature-name — the object's name vs the name in its signature. Measured on CODESYS SP21 (2026-09-17,
 * conformance `sn_*`): FUNCTION_BLOCK, FUNCTION, PROGRAM and DUT are held to it; an INTERFACE is not, even with
 * an FB implementing it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

const at = (uri: string, source: string, vendor: Vendor = "codesys"): string[] => {
  const parseResult = parseSource(source, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri, parseResult, source }], [], vendor)
  return computeSemanticDiagnostics({ uri, parseResult, source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "signature-name-mismatch")
    .map((d) => d.message)
}
const MISMATCH = ["The name used in the signature is not identical to the object name"]

test("a POU whose signature names something other than its object", () => {
  expect(at("FB_Object.pou", `FUNCTION_BLOCK FB_Signature\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual(MISMATCH)
  expect(at("F_Object.pou", `FUNCTION F_Signature : INT\nF_Signature := 1;\nEND_FUNCTION`)).toEqual(MISMATCH)
  expect(at("PRG_Object.pou", `PROGRAM PRG_Signature\nVAR\nn : INT;\nEND_VAR\nEND_PROGRAM`)).toEqual(MISMATCH)
  expect(at("DUT_Object.dut", `TYPE DUT_Signature :\nSTRUCT\nx : INT;\nEND_STRUCT\nEND_TYPE`)).toEqual(MISMATCH)
})

test("an INTERFACE is exempt — measured with an FB implementing it, not merely unreferenced", () => {
  expect(at("ITF_Object.itf", `INTERFACE ITF_Signature\nMETHOD Run : INT\nEND_METHOD\nEND_INTERFACE`)).toEqual([])
})

test("agreement, and case-only difference, are silent — IEC names are case-insensitive", () => {
  expect(at("FB_Same.pou", `FUNCTION_BLOCK FB_Same\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(at("FB_Casing.pou", `FUNCTION_BLOCK fb_CASING\nVAR\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("a file packing SEVERAL items is not a workspace file, so it is skipped", () => {
  // A conformance fixture inlines its dependencies; the file is named after only one of them.
  expect(at("FB_One.pou", `FUNCTION_BLOCK FB_One\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_Two\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// TWINCAT MEASURED, 2026-09-20: `sn_dut_mismatch_used` — a DUT whose type name disagrees with its object, with
// one FB declaring a variable of it — records this message on BOTH vendors, word for word. (Unreferenced, it
// records on neither: that is reachability, and it is in `KNOWN_DIVERGENCES` on both sides.)
test("TwinCAT reports it too", () => {
  expect(at("FB_Object.pou", `FUNCTION_BLOCK FB_Signature\nEND_FUNCTION_BLOCK`, "twincat")).toEqual(MISMATCH)
})

// analysis-conformance 3.4 (both vendors, recorded 2026-10-06, `sn_alias_mismatch_used`, `sn_enum_mismatch_used`,
// `sn_union_mismatch_used`): every DUT body is held to it — an ALIAS too, which has no scope of its own, so the object's
// name is read from the document's uri, not from a scope's
test("an ALIAS, an ENUM and a UNION whose signature names another object", () => {
  expect(at("DUT_AliasObject.dut", `TYPE DUT_AliasSignature : INT;\nEND_TYPE`)).toEqual(MISMATCH)
  expect(at("DUT_EnumObject.dut", `TYPE DUT_EnumSignature :\n(\n\ta,\n\tb\n);\nEND_TYPE`)).toEqual(MISMATCH)
  expect(at("DUT_UnionObject.dut", `TYPE DUT_UnionSignature :\nUNION\n\ti : INT;\n\tw : WORD;\nEND_UNION\nEND_TYPE`)).toEqual(MISMATCH)
  expect(at("DUT_AliasSame.dut", `TYPE DUT_AliasSame : INT;\nEND_TYPE`)).toEqual([])
})
