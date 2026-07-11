/**
 * inout-own-access — C0371, a WARNING. A method/action touching its enclosing FB's VAR_IN_OUT. The FB's own
 * main body may touch it freely (no warning); only a member scope (method/action) does. Wording live-verified
 * byte-identical against the real lenze-mid build.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

// The check is opt-in (per-project option-gated); enable it for these tests.
const diag = (src: string) => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", lints: { inoutOwnAccess: true } }) })
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

test("a property GET/SET accessor touching the FB's VAR_IN_OUT warns, context '__get'/'__set'<Prop>", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROPERTY Pos : INT\nGET\nPos := io;\nEND_GET\nSET\nio := Pos;\nEND_SET\nEND_PROPERTY`
  const ds = diag(src).filter((d) => d.code === "inout-own-access").map((d) => d.message)
  expect(ds).toContain("Access to VAR_IN_OUT 'io' declared in 'FB' from external context '__getPos'")
  expect(ds).toContain("Access to VAR_IN_OUT 'io' declared in 'FB' from external context '__setPos'")
})

test("a method touching a plain local (not a VAR_IN_OUT) does NOT warn", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n loc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nloc := loc + 1;\nEND_METHOD`
  expect(diag(src).filter((d) => d.code === "inout-own-access")).toEqual([])
})

test("OFF by default — it's per-project option-gated (pro2193 builds 0 of these), so no FP on a quiet project", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD Meth : BOOL\nio := 5;\nEND_METHOD`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const ds = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.filter((d) => d.code === "inout-own-access")).toEqual([])
})
