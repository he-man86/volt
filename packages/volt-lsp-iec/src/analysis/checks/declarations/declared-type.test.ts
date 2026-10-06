/**
 * declared-type: the declared types both vendors refuse once they are READ (frontend-conformance 2.3.6, T2/T4/T7/T11) —
 * each test a recorded fixture's answer (`test/conformance/fixtures/grammar/type-expressions.ts`, 2026-10-01).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

type Vendor = "codesys" | "twincat"

/** The messages of `code` for `src` (whole units), on `vendor`. */
function run(code: string, src: string, vendor: Vendor = "codesys"): string[] {
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === code)
    .map((d) => d.message)
}
const fb = (sections: string) => `FUNCTION_BLOCK F\n${sections}\nEND_FUNCTION_BLOCK`
const inVar = (decl: string) => fb(`VAR\n\t${decl}\nEND_VAR`)

test("T2/T4 — a reversed subrange or array dimension: 'Lower border must be lower than upper border'", () => {
  // `decl_subrange_reversed`, `decl_array_reversed_bounds`; TwinCAT ends the sentence with a period
  expect(run("border-order", inVar("v : INT(10..0);"))).toEqual(["Lower border must be lower than upper border"])
  expect(run("border-order", inVar("a : ARRAY[5..1] OF INT;"))).toEqual(["Lower border must be lower than upper border"])
  expect(run("border-order", inVar("a : ARRAY[5..1] OF INT;"), "twincat")).toEqual(["Lower border must be lower than upper border."])
  // in order, negative, or from constants: nothing (`decl_array_both_negative`, `decl_subrange_constant_bounds`)
  expect(run("border-order", inVar("a : ARRAY[-3..-1] OF INT;\n\tv : UINT(1..5);"))).toEqual([])
  expect(run("border-order", fb("VAR CONSTANT\n\tLO : INT := 2;\n\tHI : INT := 8;\nEND_VAR\nVAR\n\tv : INT(LO..HI);\nEND_VAR"))).toEqual([])
})

test("T7 — a REFERENCE as the base type of an array, a pointer or a reference is refused", () => {
  // `decl_reference_to_reference`, `decl_pointer_to_reference`, `decl_array_of_reference`; TwinCAT has no comma
  const cs = "A reference type is not allowed as base type of an array, pointer, or reference"
  expect(run("reference-base-type", inVar("rf : REFERENCE TO REFERENCE TO INT;"))).toEqual([cs])
  expect(run("reference-base-type", inVar("p : POINTER TO REFERENCE TO INT;"))).toEqual([cs])
  expect(run("reference-base-type", inVar("a : ARRAY[0..1] OF REFERENCE TO INT;"))).toEqual([cs])
  expect(run("reference-base-type", inVar("a : ARRAY[0..1] OF REFERENCE TO INT;"), "twincat")).toEqual([
    "A reference type is not allowed as base type of an array, pointer or reference",
  ])
  // a reference TO an array, a pointer to a pointer: both build (`decl_reference_to_array`, `decl_pointer_to_pointer`)
  expect(run("reference-base-type", inVar("rf : REFERENCE TO ARRAY[0..1] OF INT;\n\tpp : POINTER TO POINTER TO INT;"))).toEqual([])
})

test("T11 — a __VECTOR of anything but REAL or LREAL is refused", () => {
  // `decl_vector_of_int`, `decl_vector_of_bool` (CODESYS; TwinCAT has no __VECTOR); `decl_vector_constant_size` builds
  expect(run("vector-base-type", inVar("v : __VECTOR[4] OF INT;"))).toEqual(["The base type of a vector must be either REAL or LREAL."])
  expect(run("vector-base-type", inVar("v : __VECTOR[4] OF BOOL;"))).toEqual(["The base type of a vector must be either REAL or LREAL."])
  expect(run("vector-base-type", inVar("v : __VECTOR[4] OF REAL;\n\tw : __VECTOR[2] OF LREAL;"))).toEqual([])
})

test("T4 — a variable-length ARRAY where each vendor takes none, in that vendor's own words", () => {
  const cs = "Variable length arrays are only possible as VAR_IN_OUT of function blocks or as VAR_IN_OUT and VAR_INPUT of methods and functions"
  const tc = "Variable-length Arrays are only possible as VAR_IN_OUT of Methods, Functions and Functionblocks"
  const where = (v: Vendor, src: string) => run("variable-length-placement", src, v)
  // a plain VAR, `[*, *]` too, and a function block's VAR_INPUT: both vendors (`decl_array_star_in_var`, `_two_stars`, `_in_fb_input`)
  for (const src of [inVar("a : ARRAY[*] OF INT;"), inVar("a : ARRAY[*, *] OF INT;"), fb("VAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR")]) {
    expect(where("codesys", src)).toEqual([cs])
    expect(where("twincat", src)).toEqual([tc])
  }
  // a FUNCTION's VAR_INPUT: CODESYS builds it, TwinCAT refuses it (`decl_array_star_in_function_input`)
  const fn = "FUNCTION G : INT\nVAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR\nG := 1;\nEND_FUNCTION"
  expect(where("codesys", fn)).toEqual([])
  expect(where("twincat", fn)).toEqual([tc])
  // a VAR_IN_OUT, anywhere: both build (`callshape_array_star_bounds`, the corpora's methods)
  expect(where("codesys", fb("VAR_IN_OUT\n\ta : ARRAY[*] OF INT;\nEND_VAR"))).toEqual([])
  expect(where("twincat", fb("VAR_IN_OUT\n\ta : ARRAY[*] OF INT;\nEND_VAR"))).toEqual([])
  // a METHOD's VAR_INPUT: as a function's — CODESYS builds and runs it, TwinCAT refuses it (`decl_array_star_in_method_input`)
  const method = `${fb("VAR\n\tout : INT;\nEND_VAR")}\nMETHOD M : INT\nVAR_INPUT\n\ta : ARRAY[*] OF INT;\nEND_VAR\nM := 1;\nEND_METHOD`
  expect(where("codesys", method)).toEqual([])
  expect(where("twincat", method)).toEqual([tc])
  // a STRUCT field: both vendors (`decl_array_star_struct_field`) — a field is no section a call lends
  const struct = "TYPE S :\nSTRUCT\n\tf : ARRAY[*] OF INT;\nEND_STRUCT\nEND_TYPE"
  expect(where("codesys", struct)).toEqual([cs])
  expect(where("twincat", struct)).toEqual([tc])
})

test("T4 — a variable-length ARRAY inside another type is refused in every section, in each vendor's words", () => {
  // `decl_array_star_nested_in_var` (ARRAY OF ARRAY[*]), `decl_pointer_to_array_star_in_var`, `decl_array_star_nested_in_inout`
  // (a VAR_IN_OUT, where a top-level one builds): both vendors, and the placement sentence is not said beside it
  const cs = "A variable length array type has to be on top level position of a type declaration"
  const tc = "A Variable-length Array type has to be on top level position of a type declaration."
  const sources = [
    inVar("a : ARRAY[0..1] OF ARRAY[*] OF INT;"),
    inVar("p : POINTER TO ARRAY[*] OF INT;"),
    fb("VAR_IN_OUT\n\ta : ARRAY[0..1] OF ARRAY[*] OF INT;\nEND_VAR"),
  ]
  for (const src of sources) {
    expect(run("variable-length-nested", src)).toEqual([cs])
    expect(run("variable-length-nested", src, "twincat")).toEqual([tc])
    expect(run("variable-length-placement", src)).toEqual([])
  }
  expect(run("variable-length-nested", inVar("a : ARRAY[*] OF INT;"))).toEqual([])
})

// …in a STRUCT's component too (`refbit_struct_array_component`, analysis-conformance 3.11 gate review, both vendors —
// beside "References to bits are not possible"): a component holds a declared type as a variable does.
test("T7 — a REFERENCE as an array's base type in a STRUCT's component is refused", () => {
  const struct = "TYPE S :\nSTRUCT\n\ta : ARRAY[0..1] OF REFERENCE TO INT;\nEND_STRUCT\nEND_TYPE"
  expect(run("reference-base-type", struct)).toEqual(["A reference type is not allowed as base type of an array, pointer, or reference"])
  expect(run("reference-base-type", struct, "twincat")).toEqual(["A reference type is not allowed as base type of an array, pointer or reference"])
})
