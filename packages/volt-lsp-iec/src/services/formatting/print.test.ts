/**
 * The formatter's printer rules (frontend-conformance 2.9, PR2 and PR4): what the engineer wrote in a declaration's header
 * comes back as written. The printer is Volt's, so no vendor recording decides these — the 0.2 fixed point
 * (`test/frontend/fixed-point.test.ts`) and these tests do.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { formatDocument } from "../index.js"

const format = (source: string, uri = "file:///F.fb"): { text: string; errors: number } => {
  const parseResult = parseSource(source, { networkText: true })
  return { text: formatDocument({ uri, source, parseResult }), errors: parseResult.errors.length }
}

// `x : INT AT %IX0.0;` is no grammar on either vendor (D10, `decl_at_after_type*`): the parse refuses it, so the unit is
// kept as written — reprinted from the AST it would lose the address, which the declaration does not hold.
test("AT after the type round-trips", () => {
  const src =
    "FUNCTION_BLOCK F\nVAR\n\tx : INT AT %IX0.0;\n\ty AT %QX0.1 : BOOL;\nEND_VAR\nIMPLEMENTATION ST\ny := TRUE;\nEND_FUNCTION_BLOCK\n"
  const r = format(src)
  expect(r.errors).toBeGreaterThan(0)
  expect(r.text).toBe(src)
  // the AT a declaration may carry (before the colon) is reprinted from the AST, as written
  const before = format("FUNCTION_BLOCK F\nVAR\n\ty AT %QX0.1 : BOOL;\n\tstr AT %MB4 : STRING[10];\nEND_VAR\nEND_FUNCTION_BLOCK\n")
  expect([before.errors, before.text]).toEqual([
    0,
    "FUNCTION_BLOCK F\nVAR\n\ty AT %QX0.1 : BOOL;\n\tstr AT %MB4 : STRING[10];\nEND_VAR\nEND_FUNCTION_BLOCK\n",
  ])
})

// The parser keeps every unit's modifiers as an ordered list (`unit_method_final_private_order` and siblings); the printer
// writes them back in that order, on a METHOD, an FB, a PROPERTY and its accessors, and an interface's members. A header
// the parse refuses (`METHOD FINAL PUBLIC`) is kept as written.
test("method modifiers keep their order", () => {
  const clean: [string, string][] = [
    ["METHOD PROTECTED FINAL M : INT\nEND_METHOD\n", "file:///M.meth"],
    ["METHOD PUBLIC ABSTRACT M : INT\nEND_METHOD\n", "file:///M.meth"],
    ["METHOD FINAL FINAL M : INT\nEND_METHOD\n", "file:///M.meth"],
    ["FUNCTION_BLOCK INTERNAL FINAL F\nEND_FUNCTION_BLOCK\n", "file:///F.fb"],
    ["PROPERTY PROTECTED FINAL P : INT\nGET\nEND_GET\nEND_PROPERTY\n", "file:///P.prop"],
    ["INTERFACE I\n\tMETHOD PUBLIC M : BOOL\n\tEND_METHOD\n\tPROPERTY PUBLIC Q : INT\n\tGET\n\tEND_PROPERTY\nEND_INTERFACE\n", "file:///I.itf"],
  ]
  for (const [src, uri] of clean) {
    const r = format(src, uri)
    expect({ src, errors: r.errors, text: r.text }).toEqual({ src, errors: 0, text: src })
  }
  const refused = "METHOD FINAL PUBLIC M : INT\nEND_METHOD\n"
  const r = format(refused, "file:///M.meth")
  expect([r.errors > 0, r.text]).toEqual([true, refused])
})

// An interface's VAR section is refused by a check (C0149), not the parse, so the unit is reprinted from its AST — which
// dropped the section (`cc2_var_in_interface`, `hdr_interface_var_input`, `itf_var_section_declaration`: the 0.2 fixed
// point's last three findings). It is printed where it was written, among the members.
test("an interface's VAR section survives formatting, in its place", () => {
  const src =
    "INTERFACE I\n\tMETHOD A : INT\n\tEND_METHOD\nVAR_INPUT\n\tx : INT;\nEND_VAR\n\tPROPERTY Q : INT\n\tGET\n\tEND_PROPERTY\n\tMETHOD B : INT\n\tEND_METHOD\nEND_INTERFACE\n"
  const r = format(src, "file:///I.itf")
  expect([r.errors, r.text]).toEqual([0, src])
})

// An accessor's declaration is the lines UNDER its keyword line, and the push drops that line whole (`StReader`, U16): the
// pull writes the modifier on the line under `GET` (39 such accessors in pro2193). The printer moved it up beside the
// keyword — `GET PUBLIC`, a text the push would have written to the IDE as a plain `GET` (frontend-conformance 2.10,
// found by the fixed point the day the parser refused the modifier there).
test("an accessor's modifier prints on the line under GET/SET, where the push reads it", () => {
  const src =
    "PROPERTY P : INT\nGET\nPUBLIC\nVAR\nEND_VAR\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nSET\nPROTECTED\nIMPLEMENTATION ST\nEND_SET\nEND_PROPERTY\n"
  const r = format(src, "file:///P.prop")
  expect({ errors: r.errors, text: r.text }).toEqual({ errors: 0, text: src })
})
