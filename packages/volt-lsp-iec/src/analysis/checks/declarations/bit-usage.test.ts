/**
 * bit-usage: C0203/C0204 (BIT in a wrong container/block) + C0205 (POINTER TO BIT) + C0206 (ARRAY OF BIT).
 *
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const errs = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code.startsWith("bit-") || d.code === "pointer-to-bit" || d.code === "reference-to-bit")
    .map((d) => d.message)
}

test("C0203: a BIT var in a PROGRAM is flagged; in an FB VAR-block it is fine", () => {
  expect(errs(`PROGRAM P\nVAR b:BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual([
    "Only structures and function blocks can contain variables of type BIT",
  ])
  expect(errs(`FUNCTION_BLOCK F\nVAR b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// …and CODESYS adds the reference rule's sentence: a VAR_IN_OUT passes the BIT by reference (`bitu_fb_var_in_out`,
// recorded; this test held the section's message alone while no check gave the other, analysis-conformance 3.11)
test("C0204: a BIT var in an FB VAR_IN_OUT block is flagged", () => {
  expect(errs(`FUNCTION_BLOCK F\nVAR_IN_OUT b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section",
    "References to bits are not possible",
  ])
})

test("C0205/C0206: POINTER TO BIT and ARRAY OF BIT are flagged anywhere", () => {
  expect(errs(`PROGRAM P\nVAR pt:POINTER TO BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual(["POINTER TO BIT is not allowed"])
  expect(errs(`PROGRAM P\nVAR a:ARRAY[1..2] OF BIT;\nEND_VAR\nEND_PROGRAM`)).toEqual(["BIT is not allowed as base type of an array"])
})

test("a BIT struct field stays quiet (structs allow BIT)", () => {
  expect(errs(`TYPE sv : STRUCT b:BIT; END_STRUCT END_TYPE`)).toEqual([])
})

test("C0203: a BIT global variable is flagged — a global list is no structure (`ty_bit_in_gvl`, both vendors 2026-10-03)", () => {
  expect(errs(`VAR_GLOBAL\n\tg : BIT;\nEND_VAR\n`)).toEqual(["Only structures and function blocks can contain variables of type BIT"])
})

test("a BIT in an FB's VAR_TEMP: CODESYS says the section AND the container, TwinCAT the section (bitu_fb_var_temp)", () => {
  const src = `FUNCTION_BLOCK F\nVAR_TEMP b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(errs(src)).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section",
    "Only structures and function blocks can contain variables of type BIT",
  ])
  const pr = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "twincat")
  expect(
    computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "twincat" }) })
      .filter((d) => d.code.startsWith("bit-"))
      .map((d) => d.message),
  ).toEqual(["Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT or VAR-block"])
  // VAR_STAT is the section alone on both (bitu_fb_var_stat)
  expect(errs(`FUNCTION_BLOCK F\nVAR_STAT b:BIT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section",
  ])
})

// "References to bits are not possible" (analysis-conformance 3.11): a REFERENCE TO BIT anywhere — a variable, an input,
// a STRUCT component — on both vendors (`ty_reference_to_bit`, `refbit_var_input`, `refbit_struct_field`); and on CODESYS
// a BIT in a VAR_IN_OUT, which is passed by reference, beside the section's own message (`bitu_fb_var_in_out`,
// `refbit_inout_constant_bit`, `refbit_function_inout_bit` — TwinCAT says only the section's).
test("a reference to a BIT: REFERENCE TO BIT on both vendors, a BIT in a VAR_IN_OUT on CODESYS", () => {
  const vendorErrs = (src: string, vendor: "codesys" | "twincat"): string[] => {
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code.startsWith("bit-") || d.code === "pointer-to-bit" || d.code === "reference-to-bit")
      .map((d) => d.message)
  }
  const REF = "References to bits are not possible"
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(vendorErrs("FUNCTION_BLOCK F\nVAR\n\trb : REFERENCE TO BIT;\nEND_VAR\nEND_FUNCTION_BLOCK", vendor)).toEqual([REF])
    expect(vendorErrs("FUNCTION_BLOCK F\nVAR_INPUT\n\trb : REFERENCE TO BIT;\nEND_VAR\nEND_FUNCTION_BLOCK", vendor)).toEqual([REF])
    expect(vendorErrs("TYPE S :\nSTRUCT\n\trb : REFERENCE TO BIT;\nEND_STRUCT\nEND_TYPE", vendor)).toEqual([REF])
  }
  expect(vendorErrs("FUNCTION_BLOCK F\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nEND_FUNCTION_BLOCK", "codesys")).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section",
    REF,
  ])
  expect(vendorErrs("FUNCTION_BLOCK F\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nEND_FUNCTION_BLOCK", "twincat")).toEqual([
    "Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT or VAR-block",
  ])
  expect(vendorErrs("FUNCTION F : INT\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nF := 1;\nEND_FUNCTION", "codesys")).toEqual([
    "Only structures and function blocks can contain variables of type BIT",
    REF,
  ])
})

// The 3.11 gate review's cells: a BIT in a PROGRAM's and a METHOD's VAR_IN_OUT says both sentences on CODESYS, the
// section's alone on TwinCAT (`refbit_program_inout_bit`, `refbit_method_inout_bit`); REFERENCE TO BIT in a GVL, a
// PROGRAM's VAR and a FUNCTION's VAR says the reference sentence alone (`refbit_gvl_reference`, `_program_var_reference`,
// `_function_var_reference`); and as an ARRAY's element, a STRUCT's component or a VAR, the reference sentence beside the
// array's own refusal (`refbit_struct_array_component`, `refbit_var_array_reference`, both vendors).
test("a reference to a BIT in every POU kind, and as an array's element", () => {
  const vendorErrs = (src: string, vendor: "codesys" | "twincat"): string[] => {
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code.startsWith("bit-") || d.code === "pointer-to-bit" || d.code === "reference-to-bit")
      .map((d) => d.message)
  }
  const REF = "References to bits are not possible"
  const programInout = "PROGRAM P\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nEND_PROGRAM"
  const methodInout = "FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nM := 1;\nEND_METHOD"
  for (const src of [programInout, methodInout]) {
    expect(vendorErrs(src, "codesys")).toEqual(["Only structures and function blocks can contain variables of type BIT", REF])
    expect(vendorErrs(src, "twincat")).toEqual(["Only Structures and Function Blocks can contain variables of type BIT."])
  }
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(vendorErrs("VAR_GLOBAL\n\trb : REFERENCE TO BIT;\nEND_VAR", vendor)).toEqual([REF])
    expect(vendorErrs("PROGRAM P\nVAR\n\trb : REFERENCE TO BIT;\nEND_VAR\nEND_PROGRAM", vendor)).toEqual([REF])
    expect(vendorErrs("FUNCTION G : BOOL\nVAR\n\trb : REFERENCE TO BIT;\nEND_VAR\nG := TRUE;\nEND_FUNCTION", vendor)).toEqual([REF])
    expect(vendorErrs("TYPE S :\nSTRUCT\n\trbits : ARRAY[0..1] OF REFERENCE TO BIT;\nEND_STRUCT\nEND_TYPE", vendor)).toEqual([REF])
    expect(vendorErrs("FUNCTION_BLOCK F\nVAR\n\trbits : ARRAY[0..1] OF REFERENCE TO BIT;\nEND_VAR\nEND_FUNCTION_BLOCK", vendor)).toEqual([REF])
  }
})
