/**
 * Lowering's call parameter view (task 1.7.18): the positional order, a chain's in-out sections, a prefixed section. Its
 * agreement with the front-end's `resolveCallee` over every call of the lowered fixtures is
 * `test/conformance/call-parameters.test.ts` (the fixtures are under `test/`, which `src/` does not import).
 */
import { expect, test } from "bun:test"
import { parseSource, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
import { TRANSPILE_PARSE } from "../project/prepare.js"
import { inOutSections, positionalBinding, positionalParameters, prefixed } from "./parameters.js"

const unit = (src: string) => parseSource(src, TRANSPILE_PARSE).units[0] as Extract<TopLevel, { varSections: readonly VarSection[] }>
const F = unit("FUNCTION F : INT\nVAR_INPUT a : INT; END_VAR\nVAR_OUTPUT q : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR_INPUT b : INT; END_VAR\nVAR t : INT; END_VAR\nF := a;\nEND_FUNCTION\n")

test("the positional order: every VAR_INPUT, VAR_OUTPUT and VAR_IN_OUT name as written — VAR not among them", () => {
  expect(positionalParameters(F.varSections).map((p) => `${p.name}${p.output ? "=>" : ""}:${p.sectionKind}`)).toEqual([
    "a:VAR_INPUT",
    "q=>:VAR_OUTPUT",
    "io:VAR_IN_OUT",
    "b:VAR_INPUT",
  ])
})

test("a chain's in-out sections, base first as the chain is given; a section under a prefix", () => {
  const base = unit("FUNCTION_BLOCK B\nVAR_IN_OUT x : INT; END_VAR\nEND_FUNCTION_BLOCK\n")
  const derived = unit("FUNCTION_BLOCK D EXTENDS B\nVAR_IN_OUT y : INT; END_VAR\nVAR_INPUT i : INT; END_VAR\nEND_FUNCTION_BLOCK\n")
  expect(inOutSections([base, derived] as never).flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => n.text)))).toEqual(["x", "y"])
  expect(prefixed(F.varSections[0]!, "__F_").decls[0]!.names[0]!.text).toBe("__F_a")
})

test("what a positional argument binds to: the parameter at its position, refused past the parameters or across a VAR_OUTPUT", () => {
  // `F(1, ...)`: `a`; the second position is the VAR_OUTPUT `q` — refused, and so is every position after it (the
  // front-end skips the output and binds the next input; neither rule is recorded — 1.7.18's difference, 6.B.4's input)
  const declared = positionalParameters(F.varSections)
  const bound = (position: number) => {
    const p = positionalBinding(declared, position)
    return typeof p === "string" ? p : p.name
  }
  expect([0, 1, 2, 3, 4].map(bound)).toEqual(["a", "across-output", "across-output", "across-output", "past-parameters"])
})
