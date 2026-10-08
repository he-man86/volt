/**
 * Lowering tests of `tags.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

// Interfaces (conformance `itf_*`): an interface variable had no representation (`slot-interface`), so nothing called
// through one lowered. It holds the tag of its instance, and each call dispatches once every store has lowered.
const INTERFACES =
  "INTERFACE I_Base\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\n" +
  "INTERFACE I_Shape EXTENDS I_Base\nPROPERTY Size : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\n" +
  "FUNCTION_BLOCK FB_Sq IMPLEMENTS I_Shape\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n" +
  "FUNCTION_BLOCK FB_Rc IMPLEMENTS I_Base\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 7;\nEND_METHOD\n"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// Interface inputs (conformance `itf_fb_input_*`, `itf_method_input_passed_on`, `itf_interface_variable_as_input`): refused as
// `interface-input`. An FB keeps the instance given — a tag in its field — and each body that calls through one is lent a
// `&mut` of the instances its callers hold (design §24). Why missed: no fixture passed an instance to an interface input.
test("an interface input is a kept tag, and each body is lent by its callers the instances it calls through", () => {
  const source =
    "PROGRAM P\nVAR sq : FB_Sq; meter : FB_Meter; outer : FB_Outer; beforeAny : INT; given : INT; leftOut : INT; END_VAR\n" +
    "meter(measured => beforeAny);\nmeter(shape := sq, measured => given);\nmeter(measured => leftOut);\nouter.Measure(shape := sq);\nEND_PROGRAM\n" +
    INTERFACES +
    "FUNCTION_BLOCK FB_Meter\nVAR_INPUT shape : I_Base; END_VAR\nVAR_OUTPUT measured : INT; END_VAR\nIF shape = 0 THEN\n  measured := -1;\nELSE\n  measured := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION F_Ten : INT\nVAR_INPUT shape : I_Base; END_VAR\nF_Ten := shape.Area() * 10;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Outer\nVAR inner : FB_Meter; END_VAR\nVAR_OUTPUT viaFunction : INT; viaInner : INT; END_VAR\nEND_FUNCTION_BLOCK\n" +
    "METHOD Measure\nVAR_INPUT shape : I_Base; END_VAR\nviaFunction := F_Ten(shape := shape);\ninner(shape := shape);\nviaInner := inner.measured;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  // null before any is given; then the instance given, KEPT when a later call leaves the input out; passed on by a METHOD
  expect(["beforeAny", "given", "leftOut", "outer.viaFunction", "outer.viaInner"].map((v) => runner.get(v))).toEqual([-1n, 9n, 9n, 90n, 9n])
})

// Review of the interface-input batch (2026-09-15), each reproduced in both backends: a tag naming a field of ONE FB
// instance reached another instance of the same type — through a read of that instance's interface field, and through a
// METHOD of an in-out — and answered for the wrong instance (25 for 9). Each crossing is refused now; the parent that owns
// a child and hands it its own field (the corpus's shape) still lowers, each instance its own child.
test("an interface naming an instance's own field stays with that instance: crossing is refused, not answered wrong", () => {
  const shapes = "INTERFACE I_S\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_S IMPLEMENTS I_S\nVAR_INPUT side : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\n"
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const holder = "FUNCTION_BLOCK FB_X\nVAR_INPUT k : INT; shape : I_S; END_VAR\nVAR_OUTPUT mine : I_S; area : INT; END_VAR\nVAR a : FB_S; END_VAR\na(side := k);\nmine := a;\nIF shape <> 0 THEN\n  area := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n"
  expect(codes(`PROGRAM P\nVAR x1 : FB_X; x2 : FB_X; END_VAR\nx1(k := 3);\nx2(k := 5, shape := x1.mine);\nEND_PROGRAM\n${shapes}${holder}`)).toContain("interface-place")
  const parent =
    "FUNCTION_BLOCK FB_M\nVAR_INPUT shape : I_S; END_VAR\nVAR_OUTPUT got : INT; END_VAR\nIF shape <> 0 THEN\n  got := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_O\nVAR_INPUT k : INT; END_VAR\nVAR sv : FB_S; m : FB_M; END_VAR\nsv(side := k);\nm(shape := sv);\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(`PROGRAM P\nVAR o1 : FB_O; o2 : FB_O; END_VAR\no1(k := 3);\no2(k := 5);\nEND_PROGRAM\n${shapes}${parent}`, "P"))
  runner.scan()
  expect([runner.get("o1.m.got"), runner.get("o2.m.got")]).toEqual([9n, 25n])
  const meter =
    "FUNCTION_BLOCK FB_Meter\nVAR_INPUT shape : I_S; END_VAR\nVAR_OUTPUT measured : INT; END_VAR\nIF shape <> 0 THEN\n  measured := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\nMETHOD SetShape\nVAR_INPUT sv : I_S; END_VAR\nshape := sv;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_H\nVAR_INPUT k : INT; END_VAR\nVAR sq : FB_S; END_VAR\nsq(side := k);\nEND_FUNCTION_BLOCK\nMETHOD Give\nVAR_IN_OUT m : FB_Meter; END_VAR\nm.SetShape(sv := sq);\nEND_METHOD\nMETHOD Use : INT\nVAR_IN_OUT m : FB_Meter; END_VAR\nm();\nUse := m.measured;\nEND_METHOD\n"
  expect(codes(`PROGRAM P\nVAR meter : FB_Meter; a : FB_H; b : FB_H; n : INT; END_VAR\na(k := 3);\nb(k := 5);\na.Give(m := meter);\nn := b.Use(m := meter);\nEND_PROGRAM\n${shapes}${meter}`)).toContain("interface-instance-relative")
  // an FB type given an interface input from two frames (a limitation), and an instance lent to a call on itself
  expect(codes(`PROGRAM P\nVAR sq : FB_S; m : FB_M; o : FB_O; END_VAR\nsq(side := 2);\nm(shape := sq);\no(k := 4);\nEND_PROGRAM\n${shapes}${parent}`)).toContain("interface-context")
  const poke = "METHOD Poke\nVAR_INPUT shape : I_S; END_VAR\nVAR t : INT; END_VAR\nt := shape.Area();\nEND_METHOD\n"
  // (appended after FB_S's own METHOD, a METHOD of FB_S — `METHOD Area` also opens the interface's prototype)
  expect(codes(`PROGRAM P\nVAR sq : FB_S; END_VAR\nsq.Poke(shape := sq);\nEND_PROGRAM\n${shapes}${poke}`)).toContain("interface-lend-alias")
})
