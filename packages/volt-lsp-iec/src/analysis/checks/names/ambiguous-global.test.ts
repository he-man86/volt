/**
 * ambiguous-global — C0136. A bare reference to a global declared in 2+ project GVLs is ambiguous; a single
 * definition, a locally-shadowing var, and a qualified `GVL.name` all stay silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const GVL1 = "VAR_GLOBAL\n g_i : INT;\nEND_VAR"
const GVL2 = "VAR_GLOBAL\n g_i : INT;\nEND_VAR"
const run = (prg: string, extraGvl2 = true) => {
  const inputs = [
    { uri: "PLC_PRG.prg", source: prg, parseResult: parseSource(prg) },
    { uri: "GVL1.gvl", source: GVL1, parseResult: parseSource(GVL1) },
    ...(extraGvl2 ? [{ uri: "GVL2.gvl", source: GVL2, parseResult: parseSource(GVL2) }] : []),
  ]
  const project = buildSymbolTable(inputs)
  return computeSemanticDiagnostics({ parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "ambiguous-global")
}

test("C0136 — bare ref to a global declared in two GVLs (initializer)", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM")
  expect(ds.length).toBe(1)
  expect(ds[0].message).toBe(`ambiguous use of name 'g_i'`)
})

test("bare ref when the global is declared in only one GVL — no FP", () => {
  expect(run("PROGRAM PLC_PRG\nVAR\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM", false)).toEqual([])
})

test("a local var shadowing the ambiguous name — no FP", () => {
  expect(run("PROGRAM PLC_PRG\nVAR\n g_i : INT;\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM")).toEqual([])
})
