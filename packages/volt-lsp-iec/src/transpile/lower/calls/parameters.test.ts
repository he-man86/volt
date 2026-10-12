/**
 * Lowering's call parameter view (task 1.7.18): the positional order, a chain's in-out sections, a prefixed section. Its
 * agreement with the front-end's `resolveCallee` over every call of the lowered fixtures is
 * `test/conformance/call-parameters.test.ts` (the fixtures are under `test/`, which `src/` does not import).
 */
import { expect, test } from "bun:test"
import { parseSource, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
import { TRANSPILE_PARSE } from "../project/prepare.js"
import { inOutSections, positionalBinding, positionalParameters, prefixed } from "./parameters.js"

const unit = (src: string) => parseSource(src, TRANSPILE_PARSE, "codesys").units[0] as Extract<TopLevel, { varSections: readonly VarSection[] }>
const F = unit("FUNCTION F : INT\nVAR_INPUT a : INT; END_VAR\nVAR_OUTPUT q : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR_INPUT b : INT; END_VAR\nVAR t : INT; END_VAR\nF := a;\nEND_FUNCTION\n")

test("the positional order: every VAR_INPUT and VAR_IN_OUT name as written — a VAR_OUTPUT and a VAR not among them", () => {
  // the front-end's rule (`types/infer/callee` `isPositionalSection`), recorded by `tr_b4_positional_past_output` (6.B.4)
  expect(positionalParameters(F.varSections).map((p) => `${p.name}:${p.sectionKind}`)).toEqual(["a:VAR_INPUT", "io:VAR_IN_OUT", "b:VAR_INPUT"])
})

test("a chain's in-out sections, base first as the chain is given; a section under a prefix", () => {
  const base = unit("FUNCTION_BLOCK B\nVAR_IN_OUT x : INT; END_VAR\nEND_FUNCTION_BLOCK\n")
  const derived = unit("FUNCTION_BLOCK D EXTENDS B\nVAR_IN_OUT y : INT; END_VAR\nVAR_INPUT i : INT; END_VAR\nEND_FUNCTION_BLOCK\n")
  expect(inOutSections([base, derived] as never).flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["x", "y"])
  expect(prefixed(F.varSections[0]!, "__F_").decls[0]!.names[0]!.text).toBe("__F_a")
})

test("what a positional argument binds to: the parameter at its position — the VAR_OUTPUT skipped — or none past them", () => {
  // CODESYS skips an output declared among the parameters (`tr_b4_positional_past_output`: F(3, 4) binds `b`, 304) and
  // counts none past the inputs (`tr_b4_positional_into_output`: "requires exactly '2' inputs") — 6.B.4
  const declared = positionalParameters(F.varSections)
  const bound = (position: number) => {
    const p = positionalBinding(declared, position)
    return typeof p === "string" ? p : p.name
  }
  expect([0, 1, 2, 3].map(bound)).toEqual(["a", "io", "b", "past-parameters"])
})
