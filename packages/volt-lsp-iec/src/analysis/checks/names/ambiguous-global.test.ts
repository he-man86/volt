/**
 * ambiguous-global — C0136. A bare reference to a global declared in 2+ project GVLs is ambiguous; a single
 * definition, a locally-shadowing var, and a qualified `GVL.name` all stay silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const GVL1 = "VAR_GLOBAL\n g_i : INT;\nEND_VAR"
const GVL2 = "VAR_GLOBAL\n g_i : INT;\nEND_VAR"
const run = (prg: string, extraGvl2 = true) => {
  const inputs = [
    { uri: "PLC_PRG.pou", source: prg, parseResult: parseSource(prg, { networkText: true }) },
    { uri: "GVL1.gvl", source: GVL1, parseResult: parseSource(GVL1, { networkText: true }) },
    ...(extraGvl2 ? [{ uri: "GVL2.gvl", source: GVL2, parseResult: parseSource(GVL2, { networkText: true }) }] : []),
  ]
  const project = build.buildSymbolTable(inputs)
  return computeSemanticDiagnostics({ uri: inputs[0].uri, parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "ambiguous-global")
}

test("C0136 — bare ref to a global declared in two GVLs (initializer)", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM")
  expect(ds.length).toBe(1)
  expect(ds[0].message).toBe(`Ambiguous use of name 'g_i'`)
})

test("bare ref when the global is declared in only one GVL — no FP", () => {
  expect(run("PROGRAM PLC_PRG\nVAR\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM", false)).toEqual([])
})

test("a local var shadowing the ambiguous name — no FP", () => {
  expect(run("PROGRAM PLC_PRG\nVAR\n g_i : INT;\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM")).toEqual([])
})

test("a GVL an EDIT adds makes the name ambiguous — the incremental re-index keeps the project Scope", () => {
  // `WorkspaceStore` binds an added file into the same project Scope; the ambiguous set was memoized on the Scope
  // alone, so the second declaration was never counted
  const prg = "PROGRAM PLC_PRG\nVAR\n j : INT := g_i;\nEND_VAR\nEND_PROGRAM"
  const prgParse = parseSource(prg, { networkText: true })
  const project = build.buildSymbolTable([
    { uri: "PLC_PRG.pou", source: prg, parseResult: prgParse },
    { uri: "GVL1.gvl", source: GVL1, parseResult: parseSource(GVL1, { networkText: true }) },
  ])
  const ambiguous = () =>
    computeSemanticDiagnostics({ uri: uriFor(prgParse), parseResult: prgParse, source: prg, project, config: resolveConfig({ vendor: "codesys" }) }).filter((d) => d.code === "ambiguous-global").length
  expect(ambiguous()).toBe(0)
  build.bindFile(project, { uri: "GVL2.gvl", source: GVL2, parseResult: parseSource(GVL2, { networkText: true }) })
  expect(ambiguous()).toBe(1)
})

// Rule EN3 (frontend-conformance 3.3, both vendors 2026-10-02, `fixtures/names/enums.ts`): a member two enums declare is
// "Ambiguous use of name" — and "Identifier not defined" — wherever it is written bare: a store to one of the two enums
// (`enum_same_member_two_enums`), to an INT, a comparison, a CASE label. Qualified, or a member one enum alone declares,
// it is silent; so is a local of the name, which is the declaration the name means (EN5)
const TWO_ENUMS = "TYPE E_A : (en_x := 3, en_y := 4);\nEND_TYPE\nTYPE E_B : (en_x := 5, en_z := 6);\nEND_TYPE"
const inEnumProject = (prg: string) => {
  const inputs = [
    { uri: "PLC_PRG.pou", source: prg, parseResult: parseSource(prg, { networkText: true }) },
    { uri: "E.dut", source: TWO_ENUMS, parseResult: parseSource(TWO_ENUMS, { networkText: true }) },
  ]
  return computeSemanticDiagnostics({ uri: inputs[0].uri, parseResult: inputs[0].parseResult, source: prg, project: build.buildSymbolTable(inputs), config: resolveConfig({ vendor: "codesys" }) })
    .map((d) => `${d.code}: ${d.message}`)
}

test("EN3 — a member two enums declare, written bare, is ambiguous and not defined", () => {
  const ds = inEnumProject("PROGRAM PLC_PRG\nVAR\n e : E_A;\nEND_VAR\ne := en_x;\nEND_PROGRAM")
  expect(ds).toContain("ambiguous-global: Ambiguous use of name 'en_x'")
  expect(ds).toContain("unresolved-identifier: Identifier 'en_x' not defined")
})

test("EN3 — qualified, unique, or shadowed by a local: silent", () => {
  const prg = "PROGRAM PLC_PRG\nVAR\n e : E_A;\n b : E_B;\nEND_VAR\ne := E_A.en_x;\ne := en_y;\nb := en_z;\nEND_PROGRAM"
  expect(inEnumProject(prg)).toEqual([])
  expect(inEnumProject("PROGRAM PLC_PRG\nVAR\n en_x : INT;\n i : INT;\nEND_VAR\ni := en_x;\nEND_PROGRAM")).toEqual([])
})

// A NAMED ARGUMENT's parameter is the callee's, not a bare reference (`sym_named_argument_beside_ambiguous_global`):
// `F(g_i := 4)` beside two lists declaring `g_i` is silent; the same name as the argument's VALUE is still the global
const F_OF_G = "FUNCTION F : INT\nVAR_INPUT\n g_i : INT;\nEND_VAR\nF := g_i;\nEND_FUNCTION"
const runWithF = (prg: string) => {
  const inputs = [
    { uri: "PLC_PRG.pou", source: prg, parseResult: parseSource(prg, { networkText: true }) },
    { uri: "F.pou", source: F_OF_G, parseResult: parseSource(F_OF_G, { networkText: true }) },
    { uri: "GVL1.gvl", source: GVL1, parseResult: parseSource(GVL1, { networkText: true }) },
    { uri: "GVL2.gvl", source: GVL2, parseResult: parseSource(GVL2, { networkText: true }) },
  ]
  const project = build.buildSymbolTable(inputs)
  return computeSemanticDiagnostics({ uri: inputs[0].uri, parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "ambiguous-global")
    .map((d) => d.message)
}

test("a named argument's parameter of the ambiguous name — silent", () => {
  expect(runWithF("PROGRAM PLC_PRG\nVAR\n i : INT;\nEND_VAR\ni := F(g_i := 4);\nEND_PROGRAM")).toEqual([])
})

test("the ambiguous name as a named argument's VALUE — still ambiguous", () => {
  expect(runWithF("PROGRAM PLC_PRG\nVAR\n i : INT;\nEND_VAR\ni := F(g_i := g_i);\nEND_PROGRAM")).toEqual([`Ambiguous use of name 'g_i'`])
})
