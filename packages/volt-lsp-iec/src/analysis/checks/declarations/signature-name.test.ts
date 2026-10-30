/**
 * signature-name — the object's name vs the name in its signature. Measured on CODESYS SP21 (2026-09-17,
 * conformance `sn_*`): FUNCTION_BLOCK, FUNCTION, PROGRAM and DUT are held to it; an INTERFACE is not, even with
 * an FB implementing it.
 */
import { test, expect } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

const at = (uri: string, source: string, vendor: Vendor = "codesys", unicodeIdentifiers = false): string[] => {
  const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers }, vendor)
  const project = build.buildSymbolTable([{ uri, parseResult, source }], [], vendor)
  return computeDiagnostics({ uri, parseResult, source, project, config: resolveConfig({ vendor, unicodeIdentifiers }) })
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

// openspec lsp-field-false-positives 1 (PLC Assist's field traffic, 199 findings on items that built clean): the server
// names a document by its file URI, which percent-encodes every character past ASCII, and the object's name was read
// from the ENCODED path — `FB_%E4%B8%BB…` never equals the signature's `FB_主控制`. The object is named as the IDE names it.
// Such objects exist only in a project whose "Unicode identifiers" is on (DIALECT C28b) — the field projects'.
test("an object with a non-ASCII name agrees with its signature when the server names it by its file URI", () => {
  const uri = (name: string) => pathToFileURL(join(process.cwd(), name)).href
  expect(at(uri("FB_主控制.pou"), `FUNCTION_BLOCK FB_主控制\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nx := 1;\nEND_FUNCTION_BLOCK\n`, "codesys", true)).toEqual([])
  expect(at(uri("系统常量.dut"), `TYPE 系统常量 :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n`, "codesys", true)).toEqual([])
  expect(at(uri("FB_Привод.pou"), `FUNCTION_BLOCK FB_Привод\nEND_FUNCTION_BLOCK\n`, "codesys", true)).toEqual([])
  // …and a real disagreement is still one
  expect(at(uri("FB_主控制.pou"), `FUNCTION_BLOCK FB_副控制\nEND_FUNCTION_BLOCK\n`, "codesys", true)).toEqual(MISMATCH)
})
