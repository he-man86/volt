/**
 * THE FUNCTION_BLOCK HEADER (design.md §4 2.4, U5–U10), as both vendors read it (`fixtures/grammar/units.ts`, recorded
 * 2026-10-01): modifiers kept in order as written, a base and interfaces read as ONE dotted name each, and an access
 * modifier only in first place.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { FunctionBlock } from "../../ast/nodes.js"

const fb = (src: string) => {
  const r = parseSource(src, { networkText: true })
  return { errors: r.errors.map((e) => e.message), unit: r.units[0] as FunctionBlock }
}

test("the modifiers are kept as an ordered list, as written (`INTERNAL FINAL`, `FINAL FINAL`)", () => {
  expect(fb("FUNCTION_BLOCK INTERNAL FINAL X\nEND_FUNCTION_BLOCK").unit.modifiers).toEqual(["INTERNAL", "FINAL"])
  // a repeated FINAL builds on both vendors (`unit_fb_final_twice`)
  const twice = fb("FUNCTION_BLOCK FINAL FINAL X\nEND_FUNCTION_BLOCK")
  expect([twice.errors, twice.unit.modifiers, twice.unit.headerRefused]).toEqual([[], ["FINAL", "FINAL"], undefined])
})

test("an access modifier after another modifier leaves the FB undeclared, with no message of its own", () => {
  // `unit_fb_modifier_twice`, `unit_fb_public_internal`, `unit_fb_final_public_order`: both vendors say nothing about the
  // header and "Unknown type" where the FB is used
  for (const head of ["PUBLIC PUBLIC", "PUBLIC INTERNAL", "FINAL PUBLIC"]) {
    const r = fb(`FUNCTION_BLOCK ${head} X\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)
    expect([head, r.errors, r.unit.name.text, r.unit.headerRefused]).toEqual([head, [], "X", true])
  }
})

test("EXTENDS and IMPLEMENTS read a qualified name as one dotted identifier", () => {
  // `unit_fb_extends_qualified`, `unit_fb_implements_qualified` — CODESYS builds both
  const r = fb("FUNCTION_BLOCK X EXTENDS Standard.TON IMPLEMENTS __SYSTEM.IQueryInterface, I2\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK")
  expect(r.errors).toEqual([])
  expect(r.unit.extends?.text).toBe("Standard.TON")
  expect(r.unit.implements?.map((i) => i.text)).toEqual(["__SYSTEM.IQueryInterface", "I2"])
  expect(r.unit.varSections).toHaveLength(1)
})

test("an IMPLEMENTS list ending in a comma: the name it wants is an identifier, a keyword included", () => {
  // `unit_fb_implements_trailing_comma`: "Identifier expected instead of 'VAR'" on both vendors — not the "Unexpected
  // token" form a keyword gets where a declaration's name stands
  expect(fb("FUNCTION_BLOCK X IMPLEMENTS I,\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK").errors[0]).toBe(
    "Identifier expected instead of 'VAR'",
  )
})

test("a return type after the FB's name is read as one (C0182 is the check's), not left to the body", () => {
  // `hdr_fb_return_type`, both vendors 2026-10-06: "Return type is only possible for POUs of type FUNCTION and METHOD", and
  // nothing else — the declarations under it are the FB's
  const r = fb("FUNCTION_BLOCK X : INT\nVAR\n\tn : INT;\nEND_VAR\nn := 1;\nEND_FUNCTION_BLOCK")
  expect(r.errors).toEqual([])
  expect(r.unit.returnType?.kind).toBe("named_type")
  expect(r.unit.varSections).toHaveLength(1)
})
