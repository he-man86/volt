/**
 * reserved-keyword — C0543, a 3-state configurable warning (default warning). Wording + trigger set verified live
 * against CODESYS 3.5.21: CHAR / WCHAR / USING warn; hard keywords parse-error, real types stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { DiagnosticState } from "../../config.js"

function rk(decl: string, state: DiagnosticState = "warning") {
  const src = `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
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
})

test("USING warns too — a name, not a keyword (lex_reserved_unused_keyword_as_name_using)", () => {
  // CODESYS builds `using : INT;` with this warning and nothing else (2026-09-30); WITH builds clean.
  expect(rk("using : INT;").map((d) => d.message)).toEqual([
    "The name 'USING' is a reserved keyword in the IEC61131-3 standard. An error will be reported in future versions.",
  ])
  expect(rk("with : INT;")).toEqual([])
})

test("an ordinary identifier or a real type name is not flagged", () => {
  expect(rk("myVar : INT;")).toEqual([])
  expect(rk("s : STRING;")).toEqual([]) // STRING is a supported type, not soft-reserved
})

test("the C0543 warning can be turned off", () => {
  expect(rk("CHAR : INT;", "off")).toEqual([])
})

test("CODESYS-only — TwinCAT accepts CHAR as an identifier silently (verified live)", () => {
  const src = `PROGRAM PLC_PRG\nVAR\n  CHAR : INT;\nEND_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "twincat")
  const d = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) }).filter(
    (x) => x.code === "reserved-keyword",
  )
  expect(d).toEqual([])
})
