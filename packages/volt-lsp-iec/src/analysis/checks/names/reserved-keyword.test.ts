/**
 * reserved-keyword — C0543, a 3-state configurable warning (default warning). Wording + trigger set verified live
 * against CODESYS 3.5.21: CHAR / WCHAR / USING warn; hard keywords parse-error, real types stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { DiagnosticState } from "../../config.js"

function rk(decl: string, state: DiagnosticState = "warning") {
  const src = `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", diagnostics: { "reserved-keyword": state } }) }).filter(
    (d) => d.code === "reserved-keyword",
  )
}

test("a var named CHAR is flagged, byte-identical to CODESYS", () => {
  const d = rk("CHAR : INT;")
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("The name 'CHAR' is a reserved keyword in the IEC61131-3 standard. An error will be reported in future versions.")
})

test("WCHAR is also flagged; the message uppercases the name", () => {
  expect(rk("WCHAR : INT;")).toHaveLength(1)
  expect(rk("wchar : INT;")[0]?.message).toContain("'WCHAR'") // IEC is case-insensitive; IDE uppercases
  // USING also warns in CODESYS, but our parser treats it as a hard keyword (parse error), so it's out of scope here.
})

test("an ordinary identifier or a real type name is not flagged", () => {
  expect(rk("myVar : INT;")).toEqual([])
  expect(rk("s : STRING;")).toEqual([]) // STRING is a supported type, not soft-reserved
})

test("the C0543 warning can be turned off", () => {
  expect(rk("CHAR : INT;", "off")).toEqual([])
})
