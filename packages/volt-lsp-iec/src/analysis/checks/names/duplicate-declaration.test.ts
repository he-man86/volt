/**
 * duplicate-declaration — a name declared twice in one scope. Two same-name METHODS get the C0582 method
 * wording (an unmarked overload — which Volt can't push either way; the bridge silently collapses it), while a
 * duplicate variable keeps the generic "local variable" wording.
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

test("C0582 — two methods with the same name in one FB", () => {
  const src = `FUNCTION_BLOCK FB_Math\nEND_FUNCTION_BLOCK\nMETHOD Calc : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\nMETHOD Calc : INT\nVAR_INPUT\n a : INT;\n b : INT;\nEND_VAR\nEND_METHOD`
  const ds = diag(src).filter((d) => d.code === "duplicate-method")
  expect(ds.length).toBe(1)
  expect(ds[0].message).toBe(`There is another method with the name 'Calc'. Use the Attribute {attribute 'overloaded'} if you want to define overloaded methods.`)
})

test("a duplicate variable keeps the generic wording (not the method one)", () => {
  const src = `PROGRAM PLC_PRG\nVAR\n x : INT;\n x : BOOL;\nEND_VAR\nEND_PROGRAM`
  const ds = diag(src).filter((d) => d.code.startsWith("duplicate-"))
  expect(ds.map((d) => d.code)).toEqual(["duplicate-declaration"])
  expect(ds[0].message).toBe(`A local variable named 'x' is already defined in 'PLC_PRG'`)
})

test("two differently-named methods are fine — no FP", () => {
  const src = `FUNCTION_BLOCK FB_Math\nEND_FUNCTION_BLOCK\nMETHOD Add2 : INT\nEND_METHOD\nMETHOD Sub2 : INT\nEND_METHOD`
  expect(diag(src).filter((d) => d.code.startsWith("duplicate-"))).toEqual([])
})
