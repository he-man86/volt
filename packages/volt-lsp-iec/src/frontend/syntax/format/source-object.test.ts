/**
 * What a workspace file's EXTENSION says its object is, and what that changes about reading its text — measured on
 * CODESYS SP21 (2026-09-30, conformance `objects/written-as-sent.ts`, push-without-header-check 4.1/4.2).
 */
import { expect, test } from "bun:test"
import { parseDocument, parseSource, sourceObjectOf } from "../index.js"

const read = (uri: string, source: string) => {
  const r = parseDocument(uri, source, { networkText: true })
  return { units: r.units.map((u) => u.kind), errors: r.errors.map((e) => e.message) }
}

// `pwh_prose_struct`, `pwh_prose_then_struct`, `pwh_empty_struct`, `pwh_unclosed_comment_struct`: CODESYS reports
// NOTHING about the object's text — only the reference fails, "Unknown type: '<name>'". The DUT declares nothing.
test("a DUT whose text does not open with TYPE declares nothing and reports nothing", () => {
  expect(read("DUT_A.dut", "this is not structured text at all\n")).toEqual({ units: [], errors: [] })
  expect(read("DUT_A.dut", "a note about the carrier\nTYPE DUT_A :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual({ units: [], errors: [] })
  expect(read("DUT_A.dut", "")).toEqual({ units: [], errors: [] })
  expect(read("DUT_A.dut", "(* Carrier state\n *\nTYPE DUT_A :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual({ units: [], errors: [] })
})

// `pwh_prose_gvl`, `pwh_prose_then_gvl`, `pwh_empty_gvl`: the same for a GVL, whose keyword is VAR_GLOBAL (or
// VAR_CONFIG — CODESYS's own "VAR_GLOBAL or VAR_CONFIG expected", `pwh_gvl_then_prose`).
test("a GVL whose text does not open with VAR_GLOBAL or VAR_CONFIG declares nothing and reports nothing", () => {
  expect(read("GVL_A.gvl", "this is not structured text at all\n")).toEqual({ units: [], errors: [] })
  expect(read("GVL_A.gvl", "a note\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n")).toEqual({ units: [], errors: [] })
  expect(read("GVL_A.gvl", "")).toEqual({ units: [], errors: [] })
})

test("comments and pragmas above the keyword are not text before it", () => {
  expect(read("GVL_A.gvl", "{attribute 'qualified_only'}\n(* the globals *)\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n")).toEqual({ units: ["global_var_list"], errors: [] })
  expect(read("DUT_A.dut", "// state\n{attribute 'pack_mode' := '1'}\nTYPE DUT_A :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual({ units: ["type_decl"], errors: [] })
})

// `pwh_struct_member_implementation`, `pwh_gvl_retired_volt_comment`: both build clean. The push writes a DUT's and a
// GVL's text as sent, so Volt's file format claims nothing in it — the IMPLEMENTATION line and the retired comment
// are rules about a POU's split, and a DUT or a GVL has none.
test("a DUT or a GVL is held to none of the file format's POU rules", () => {
  expect(read("DUT_A.dut", "TYPE DUT_A :\nSTRUCT\n\tIMPLEMENTATION : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual({ units: ["type_decl"], errors: [] })
  expect(read("GVL_A.gvl", "(* @volt-impl *)\nVAR_GLOBAL\n\tg : INT;\nEND_VAR\n")).toEqual({ units: ["global_var_list"], errors: [] })
})

test("a POU still is — and so is text read with no object", () => {
  const retired = "(* @volt-impl *)\nFUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n"
  expect(read("FB_A.pou", retired).errors).toHaveLength(1)
  expect(parseSource(retired, { networkText: true }).errors).toHaveLength(1)
  // …and a DUT's text read as no object keeps today's reading: a fixture packs several units into one text
  expect(parseSource("this is not structured text\nTYPE DUT_A :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n", { networkText: true }).units.map((u) => u.kind)).toEqual(["type_decl"])
})

// The server reads a document's object from its URI, and the client's selector is language-only: an SCM diff's HEAD
// side arrives as `git:` with the file's path encoded again in a QUERY. The object is the PATH's, never the last `.`
// of the whole string — or the HEAD side of a diff reads a DUT under the POU rules the file: side is exempt from.
test("the object is read from a URI's path, not its query or fragment", () => {
  const head =
    "git:/c%3A/w/src/DUT_A.dut?%7B%22path%22%3A%22c%3A%5C%5Cw%5C%5Csrc%5C%5CDUT_A.dut%22%2C%22ref%22%3A%22HEAD%22%7D"
  expect(sourceObjectOf("file:///c%3A/w/src/DUT_A.dut")).toBe("dut")
  expect(sourceObjectOf(head)).toBe("dut")
  expect(sourceObjectOf("file:///c%3A/w/src/GVL_A.gvl#L3")).toBe("gvl")
  expect(sourceObjectOf("file:///c%3A/w/src/notes.txt?x=A.struct")).toBeUndefined()
  expect(read(head, "TYPE DUT_A :\nSTRUCT\n\tIMPLEMENTATION : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual({ units: ["type_decl"], errors: [] })
})

// `decl_var_access`, `decl_var_access_read_only`: a GVL object whose text opens with VAR_ACCESS builds on both vendors —
// the IDE reads its declaration, so the LSP must too (thrown away here, the formatter rewrote the file to "\n").
test("a GVL whose text opens with VAR_ACCESS is a global variable list", () => {
  const source = "VAR_ACCESS\n\taccD : PLC_PRG.d : INT READ_WRITE;\nEND_VAR\n"
  expect(read("GVL_A.gvl", source)).toEqual({ units: ["global_var_list"], errors: [] })
})
