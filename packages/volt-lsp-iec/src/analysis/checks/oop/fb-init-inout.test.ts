/**
 * fb-init-inout — C0179. An inline FB-init field targeting a VAR_IN_OUT is rejected (only inputs are assignable
 * at declaration); input/output fields and non-FB targets stay silent (zero-FP). Wording provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const FB = `\nFUNCTION_BLOCK MyFB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nVAR_INPUT\n inp : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const diag = (decls: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM${FB}`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}
const codes = (decls: string): string[] => diag(decls).map((d) => d.code)

test("C0179 — single-field init assigns a VAR_IN_OUT", () => {
  const ds = diag(" fb : MyFB := (io := 3);")
  expect(ds.map((d) => d.code)).toEqual(["fb-init-inout"])
  expect(ds[0].message).toBe(`'io' is no output of 'MyFB'`)
})

test("C0179 — multi-field init flags only the VAR_IN_OUT field", () => {
  expect(codes(" fb : MyFB := (inp := 1, io := 3);")).toEqual(["fb-init-inout"])
})

test("assigning an INPUT at init is legal — no FP", () => {
  expect(codes(" fb : MyFB := (inp := 1);")).toEqual([])
})

test("a struct (non-FB) init is left alone — no FP", () => {
  const src = `TYPE S : STRUCT io : INT; END_STRUCT END_TYPE`
  const p1 = parseSource(src)
  const main = `PROGRAM PLC_PRG\nVAR\n s : S := (io := 3);\nEND_VAR\nEND_PROGRAM`
  const p2 = parseSource(main)
  const project = buildSymbolTable([{ uri: "s.struct", parseResult: p1, source: src }, { uri: "m.prg", parseResult: p2, source: main }])
  const ds = computeSemanticDiagnostics({ parseResult: p2, source: main, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.map((d) => d.code)).toEqual([])
})
