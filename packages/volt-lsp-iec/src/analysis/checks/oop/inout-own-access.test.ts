/**
 * inout-own-access — C0371, a WARNING. A method/action touching its enclosing FB's VAR_IN_OUT. The FB's own
 * main body may touch it freely (no warning); only a member scope (method/action) does. Wording live-verified
 * byte-identical against the real lenze-mid build.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const diag = (src: string) => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}

test("a method touching its FB's VAR_IN_OUT warns (C0371), byte-identical", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := 5;\nEND_METHOD`
  const ds = diag(src).filter((d) => d.code === "inout-own-access")
  expect(ds.length).toBe(1)
  expect(ds[0].severity).toBe("warning")
  expect(ds[0].message).toBe("Access to VAR_IN_OUT 'io' declared in 'FB' from external context 'Meth'")
})

test("fires once per ACCESS (like CODESYS — its 96 raw warnings dedupe to 20 unique)", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := io + 1;\nEND_METHOD`
  expect(diag(src).filter((d) => d.code === "inout-own-access").length).toBe(2) // LHS + RHS access
})

test("the FB's OWN main body touching its VAR_IN_OUT does NOT warn (it lives there)", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK`
  expect(diag(src).filter((d) => d.code === "inout-own-access")).toEqual([])
})

test("a method touching a plain local (not a VAR_IN_OUT) does NOT warn", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n loc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nloc := loc + 1;\nEND_METHOD`
  expect(diag(src).filter((d) => d.code === "inout-own-access")).toEqual([])
})
