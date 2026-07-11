/**
 * abstract-assign — C0511. A plain `:=` into a (reference to an) abstract FB is rejected; a REF= rebind and a
 * concrete-FB assignment stay silent (zero-FP). Message names the target variable. Wording CODESYS-verified.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const ABS = `\nFUNCTION_BLOCK ABSTRACT AbstractPOU\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK ConcretePOU\nEND_FUNCTION_BLOCK`
const diag = (decls: string, body: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\n${body}\nEND_PROGRAM${ABS}`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}
const codes = (decls: string, body: string): string[] => diag(decls, body).map((d) => d.code)

test("C0511 — value-assign through a REFERENCE TO abstract FB", () => {
  const ds = diag(" r1 : REFERENCE TO AbstractPOU;\n r2 : REFERENCE TO AbstractPOU;", "r1 := r2;")
  expect(ds.map((d) => d.code)).toEqual(["abstract-assign"])
  expect(ds[0].message).toBe(`The function block 'r1' is ABSTRACT and cannot be used as a target for an assignment.`)
})

test("REF= rebind of an abstract reference is legal — no FP", () => {
  expect(codes(" r1 : REFERENCE TO AbstractPOU;\n r2 : REFERENCE TO AbstractPOU;", "r1 REF= r2;")).toEqual([])
})

test("assigning a concrete FB reference is legal — no FP", () => {
  expect(codes(" r1 : REFERENCE TO ConcretePOU;\n r2 : REFERENCE TO ConcretePOU;", "r1 := r2;")).toEqual([])
})
