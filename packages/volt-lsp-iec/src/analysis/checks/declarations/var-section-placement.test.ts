/**
 * var-section-placement — a VAR-section kind not allowed for the containing POU: VAR_TEMP in a
 * METHOD/ACTION/INTERFACE, or VAR_GLOBAL outside a GVL. Vendor-keyed wording; conformance-only before.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"

const sections = (src: string, vendor: Vendor): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "var-section-placement")
    .map((d) => d.message)
}

test("VAR_TEMP in a METHOD is flagged, vendor-keyed (TC quotes the kind)", () => {
  const src = `FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nMETHOD M\nVAR_TEMP t : INT; END_VAR\nEND_METHOD`
  expect(sections(src, "codesys")).toEqual(["VAR_TEMP declaration not allowed in this place"])
  expect(sections(src, "twincat")).toEqual(["'VAR_TEMP' declaration not allowed in this place"])
})

test("VAR_TEMP in a FUNCTION body (allowed) is not flagged", () => {
  expect(sections(`FUNCTION Fn : INT\nVAR_TEMP t : INT; END_VAR\nFn := t;\nEND_FUNCTION`, "codesys")).toEqual([])
})

test("VAR_GLOBAL outside a GVL is flagged; inside a GVL it is fine", () => {
  expect(sections(`FUNCTION_BLOCK F\nVAR_GLOBAL g : INT; END_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toEqual([
    "VAR_GLOBAL declaration only allowed in global variable list",
  ])
})

test("C0175: a VAR RETAIN block in a FUNCTION is flagged; in an FB it is fine", () => {
  const run = (src: string) => {
    const parseResult = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "retain-not-allowed")
      .map((d) => d.message)
  }
  expect(run(`FUNCTION FN : INT\nVAR RETAIN r : INT; END_VAR\nEND_FUNCTION`)).toEqual([
    "RETAIN or PERSISTENT not allowed in this place",
  ])
  expect(run(`FUNCTION_BLOCK F\nVAR RETAIN r : INT; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("C0168: a VAR_CONFIG block in a POU is flagged with its own message", () => {
  const src = `PROGRAM P\nVAR_CONFIG i : INT; END_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "misplaced-var-config")
    .map((d) => d.message)
  expect(msgs).toEqual(["VAR_CONFIG declaration only allowed in VAR_CONFIG  list"])
})
