/**
 * non-callable-call — C0036. Calling a non-callable (a scalar var, or a GVL block) is flagged; a real FB
 * instance / function / method call is silent, and — the load-bearing case — a var typed as a LIBRARY FB
 * (which infers to `unknown` offline) is NOT flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"

const diag = (inputs: { uri: string; src: string }[]): { code: string; message: string }[] => {
  const parsed = inputs.map((i) => ({ uri: i.uri, source: i.src, parseResult: parseSource(i.src, { networkText: true }) }))
  const project = build.buildSymbolTable(parsed)
  return parsed.flatMap((f) => computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) }))
}
const one = (src: string) => diag([{ uri: "F.pou", src }])

test("C0035 — calling a scalar variable (CODESYS asks for a program/function/FB)", () => {
  const ds = one("PROGRAM PLC_PRG\nVAR\n i : INT;\nEND_VAR\ni();\nEND_PROGRAM").filter((d) => d.code === "invalid-call-target")
  expect(ds.map((d) => d.message)).toEqual(["Program name, function or function block instance expected instead of 'i'"])
})

test("C0036 — calling a GVL block (doc's VAR_GLOBAL case, multi-file)", () => {
  const ds = diag([
    { uri: "GVL.gvl", src: "VAR_GLOBAL\n value : INT;\nEND_VAR" },
    { uri: "PLC_PRG.pou", src: "PROGRAM PLC_PRG\nGVL();\nEND_PROGRAM" },
  ]).filter((d) => d.code === "non-callable-call")
  expect(ds.map((d) => d.message)).toEqual(["Cannot call object of type 'VAR_GLOBAL'"])
})

test("a real FB-instance call is NOT flagged", () => {
  const ds = diag([
    { uri: "P.pou", src: "PROGRAM PLC_PRG\nVAR\n inst : FB;\nEND_VAR\ninst();\nEND_PROGRAM" },
    { uri: "FB.pou", src: "FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK" },
  ]).filter((d) => d.code === "non-callable-call")
  expect(ds).toEqual([])
})

test("a var typed as an UNKNOWN (library) FB is NOT flagged — the conservative rule", () => {
  // `L_IE1P_ReadActualSeverity` is unresolved offline (a library FB); calling the instance must NOT fire.
  const ds = one("PROGRAM PLC_PRG\nVAR\n inst : L_IE1P_ReadActualSeverity;\nEND_VAR\ninst(xEnable := TRUE);\nEND_PROGRAM").filter((d) => d.code === "non-callable-call")
  expect(ds).toEqual([])
})

// A REFERENCE TO an FB IS callable, both as a body call and for its METHODs — measured (conformance
// `xo_reference_to_fb_call`: `chosen REF= right`, then `chosen(throttle := 7)` and `chosen.Boost()` build and RUN,
// leaving `right.revs` at 214 and `left` untouched). `pointer`/`reference` were in the non-callable set outright, so
// every such call was a false positive. Why missed: no fixture ever called through one — the REFERENCE TO cases all
// pinned a declaration or a read.
test("a REFERENCE TO / POINTER TO an FB is callable; one to a plain value is not", () => {
  const withEngine = (body: string) => [
    { uri: "P.pou", src: `PROGRAM PLC_PRG\nVAR\n inst : FB_Engine;\n ref : REFERENCE TO FB_Engine;\n ptr : POINTER TO FB_Engine;\n num : REFERENCE TO INT;\nEND_VAR\n${body}\nEND_PROGRAM` },
    { uri: "FB.pou", src: "FUNCTION_BLOCK FB_Engine\nVAR_INPUT\n throttle : INT;\nEND_VAR\nEND_FUNCTION_BLOCK" },
  ]
  const codes = (body: string) => diag(withEngine(body)).filter((d) => d.code === "invalid-call-target").map((d) => d.message)
  expect(codes("ref REF= inst;\nref(throttle := 7);")).toEqual([])
  expect(codes("ptr := ADR(inst);\nptr^(throttle := 7);")).toEqual([])
  // a reference to something that is not callable still is not
  expect(codes("num(1);")).toEqual(["Program name, function or function block instance expected instead of 'num'"])
})

// A variable called through the global-namespace dot is named AS WRITTEN, dot and all, and the call has no type:
// "… instead of '.gCall'" and "Cannot convert type 'Unknown type: '.gCall(1)'' to type 'INT'"
// (`expr_global_namespace_call_non_callable`, both vendors 2026-10-02). The name was the placeholder '?'.
test("C0035 — a global variable called as `.g(1)`: named as written, and the call a hole (expr_global_namespace_call_non_callable, E33)", () => {
  const ds = one("VAR_GLOBAL\n gq : INT;\nEND_VAR\nFUNCTION_BLOCK F\nVAR\n out : INT;\nEND_VAR\nout := .gq(1);\nEND_FUNCTION_BLOCK")
    .filter((d) => d.code === "invalid-call-target" || d.code === "unknown-source")
    .map((d) => d.message)
    .sort()
  expect(ds).toEqual([
    "Cannot convert type 'Unknown type: '.gq(1)'' to type 'INT'",
    "Program name, function or function block instance expected instead of '.gq'",
  ])
})

// A STRUCT type's name CALLED is "Cannot call object of type 'TYPE'" — not C0035, which the LSP said before rule DT8, nor
// nothing, which it said after (step 4.7.4 review) — beside the type name's C0230 (`type-as-value`), and its call has no
// result (`dt_struct_type_name_called`, CODESYS 2026-10-03).
test("C0036 — calling a STRUCT type's name, as a statement and as a value, calls a TYPE", () => {
  const ds = one(`TYPE Dut_s :\nSTRUCT\nx : INT;\nEND_STRUCT\nEND_TYPE
FUNCTION_BLOCK F\nVAR\nn : INT;\nEND_VAR\nDut_s();\nn := Dut_s();\nEND_FUNCTION_BLOCK`)
  const codes = new Set(["non-callable-call", "invalid-call-target", "type-name-as-value", "unknown-source"])
  expect(ds.filter((d) => codes.has(d.code)).map((d) => d.message).sort()).toEqual([
    "Cannot call object of type 'TYPE'",
    "Cannot call object of type 'TYPE'",
    "Cannot convert type 'Unknown type: 'Dut_s()'' to type 'INT'",
    "Type name 'Dut_s' not expected in this place",
    "Type name 'Dut_s' not expected in this place",
  ])
})
