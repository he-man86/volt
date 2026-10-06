/**
 * constant-context: C0161 (non-constant array bound) + C0227 (non-constant VAR CONSTANT init). Both via
 * `constancyOf`, so enum members / VAR CONSTANT stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const run =
  (code: string, open = "PROGRAM P", close = "END_PROGRAM") =>
  (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
    const src = `${open}\n${body}\n${close}`
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const bound = run("array-bound-non-const")
const cinit = run("const-init-non-const")
// C0526 is a FUNCTION's (and a METHOD's): a PROGRAM's and a FUNCTION BLOCK's input builds silently (`dflt_*`, 2026-10-06)
const dflt = run("default-not-constant", "FUNCTION F : INT", "END_FUNCTION")
const strlen = run("string-length-non-const")

test("C0161: a variable array bound is flagged; literals and constants are not", () => {
  expect(bound(`VAR\n i:INT:=3;\n a:ARRAY[1..i] OF INT;\nEND_VAR`)).toEqual(["Border 'i' of array is no constant value"])
  expect(bound(`VAR CONSTANT K:INT:=3; END_VAR\nVAR a:ARRAY[1..K] OF INT; END_VAR`)).toEqual([]) // VAR CONSTANT bound
  expect(bound(`VAR a:ARRAY[1..10] OF INT; END_VAR`)).toEqual([]) // literal bound
})

test("C0227: a VAR CONSTANT initialized from a variable is flagged; constant inits are not", () => {
  expect(cinit(`VAR i:INT; END_VAR\nVAR CONSTANT k:INT:=i; END_VAR`)).toEqual([
    "Initialisation of constant variable 'k' not constant",
  ])
  expect(cinit(`VAR CONSTANT k:INT:=5; END_VAR`)).toEqual([]) // literal init
})

test("C0526: a VAR_INPUT default that is a mutable variable is flagged; a constant one is not", () => {
  expect(dflt(`VAR i:INT; END_VAR\nVAR_INPUT p:INT:=i; END_VAR`)).toEqual(["Default value is not constant"])
  expect(dflt(`VAR_INPUT p:INT:=5; END_VAR`)).toEqual([]) // literal default
})

test("TwinCAT accepts a non-constant VAR_INPUT default where CODESYS refuses it — the gate is asserted", () => {
  // C0526 is gated `vendor === "codesys"` on a MEASURED fact (live /build: TwinCAT silently accepts it). Only
  // the CODESYS half was pinned, so removing the gate would have changed TwinCAT's answer with every test green.
  const src = `VAR i:INT; END_VAR\nVAR_INPUT p:INT:=i; END_VAR`
  expect(dflt(src, "codesys")).toEqual(["Default value is not constant"])
  expect(dflt(src, "twincat")).toEqual([])
})

test("a STRING length that is a mutable variable is flagged; a literal, an expression of them and a constant are not", () => {
  // `decl_string_length_variable` (both vendors); `decl_string_length_constant`, `_expression` build
  expect(strlen(`VAR
 n:INT:=5;
 str:STRING(n);
END_VAR`)).toEqual(["String length 'n' is no constant value"])
  expect(strlen(`VAR CONSTANT N:INT:=5; END_VAR
VAR str:STRING(N); w:WSTRING(N); END_VAR`)).toEqual([])
  expect(strlen(`VAR str:STRING(2+3); END_VAR`)).toEqual([])
})

// A mutable global read through the global-namespace dot is no constant either: "Initialisation of constant variable 'k'
// not constant" (`expr_global_namespace_variable_in_constant`, both vendors 2026-10-02) — `constancyOf` had no case for
// `.g` and answered "unknown"; a CONSTANT global through the dot stays quiet.
test("C0227: a VAR CONSTANT initialised from `.g` — a variable global flagged, a constant one not (expr_global_namespace_variable_in_constant, E33)", () => {
  const src = `VAR_GLOBAL\ngInit : INT;\nEND_VAR\nVAR_GLOBAL CONSTANT\ngConst : INT := 3;\nEND_VAR\nFUNCTION_BLOCK F\nVAR CONSTANT\nk : INT := .gInit;\nkc : INT := .gConst;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const msgs = computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "const-init-non-const")
    .map((d) => d.message)
  expect(msgs).toEqual(["Initialisation of constant variable 'k' not constant"])
})

test("C0526 is not said for a FUNCTION BLOCK's input: an FB input defaulted with a variable builds silently (dflt_fb_input_from_variable)", () => {
  const src = `FUNCTION_BLOCK FB\nVAR_INPUT p:INT:=g;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION F : INT\nVAR_INPUT q:INT:=g;\nEND_VAR\nF := q;\nEND_FUNCTION\nVAR_GLOBAL\n g : INT;\nEND_VAR`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  expect(
    computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "default-not-constant")
      .map((d) => d.message),
  ).toEqual(["Default value is not constant"]) // the FUNCTION's only (dflt_function_input_from_variable)
})

test("C0526 is not said for a PROGRAM's input, and is for a METHOD's (dflt_program_input_from_variable, dflt_method_input_from_variable)", () => {
  const src =
    `PROGRAM PR\nVAR_INPUT p:INT:=g;\nEND_VAR\nEND_PROGRAM\n` +
    `FUNCTION_BLOCK FB\nVAR\n o : INT;\nEND_VAR\no := M(q := 1);\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT q:INT:=g;\nEND_VAR\nM := q;\nEND_METHOD\n` +
    `VAR_GLOBAL\n g : INT;\nEND_VAR`
  const said = (vendor: "codesys" | "twincat") => {
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === "default-not-constant")
      .map((d) => d.message)
  }
  expect(said("codesys")).toEqual(["Default value is not constant"]) // the METHOD's only
  expect(said("twincat")).toEqual([])
})
