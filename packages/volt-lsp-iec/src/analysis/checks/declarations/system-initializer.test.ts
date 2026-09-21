/**
 * system-initializer — a `__` name the compiler does not know is a PARSE refusal inside a declaration's
 * initializer, and an ordinary undefined identifier anywhere else. Measured on both live IDEs 2026-09-21
 * (`cc_decl_init_unknown_name`, `cc_decl_init_sibling_var`, `cc_decl_init_dunder_unknown`,
 * `sysop_position_initializer`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(src: string, vendor: Vendor, codes?: readonly string[]): string[] {
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => codes === undefined || codes.includes(d.code))
    .map((d) => d.message)
}
const decl = (d: string) => `FUNCTION_BLOCK F\nVAR\n\t${d}\nEND_VAR\nEND_FUNCTION_BLOCK`

// `__POSITION` is CODESYS's, so CODESYS folds it and TwinCAT lands in the refusal. Same source, two answers,
// one rule — which is the shape every vendor difference in this repo is supposed to have.
test("a `__` name the DIALECT lacks is refused by the parser, in an initializer", () => {
  const src = decl("here : DINT := __POSITION;")
  expect(msgs(src, "twincat", ["system-initializer"])).toEqual([
    "';' expected instead of '__POSITION'",
    "Expression expected instead of '__POSITION'",
    "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'DINT'",
  ])
  expect(msgs(src, "codesys", ["system-initializer"])).toEqual([])
})

// …and it is NOT reported as an undefined identifier beside that, because the compiler never gets that far.
test("the refused name is not also called undefined", () => {
  expect(msgs(decl("here : DINT := __POSITION;"), "twincat", ["unresolved-identifier"])).toEqual([])
  // the SAME name in a BODY is exactly that, though (`sysop_position_bare_statement`)
  const body = `FUNCTION_BLOCK F\nVAR\n\there : DINT;\nEND_VAR\nhere := __POSITION;\nEND_FUNCTION_BLOCK`
  expect(msgs(body, "twincat", ["unresolved-identifier"])).toEqual(["Identifier '__POSITION' not defined"])
})

// AN INITIALIZER IS NOT A CONSTANT-ONLY PLACE, which is the reading these cells had to rule out: an ordinary
// unknown name is an undefined IDENTIFIER there, and a sibling variable is accepted outright.
test("an ordinary name in an initializer is resolved like any other", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(msgs(decl("n : DINT := nope;"), vendor, ["unresolved-identifier"])).toEqual(["Identifier 'nope' not defined"])
    expect(msgs(decl("other : DINT;\n\tn : DINT := other;"), vendor, ["unresolved-identifier"])).toEqual([])
    expect(msgs(decl("n : DINT := 7;"), vendor, ["unresolved-identifier", "system-initializer"])).toEqual([])
  }
})

// THE CORPUS FOUND THIS ONE. `{attribute 'qualified_only'}` governs access from OUTSIDE the list, and `lookup`
// drops such a symbol at every level including its own — which never mattered while the check walked bodies,
// because a GVL has no body. Real projects initialize one constant from its neighbours (pro2193's
// `GVL_Constants`), and CODESYS compiles it.
test("a qualified_only GVL's own constants resolve bare in each other's initializers", () => {
  const gvl = `{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n\tMaxX : UINT := 3;\n\tMaxY : UINT := 4;\n\tTotal : UINT := MaxX * MaxY;\nEND_VAR`
  expect(msgs(gvl, "codesys", ["unresolved-identifier"])).toEqual([])
})
