/**
 * THE PROPERTY HEADER (design.md §4 2.4, U14–U16), as both vendors read it (`fixtures/grammar/units.ts`, recorded
 * 2026-10-01): its modifiers in order as written, and an access modifier only in first place.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { Property } from "../../ast/nodes.js"

const property = (header: string) => {
  const r = parseSource(`FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK\n\n${header}\nGET\nP := 6;\nEND_GET\nEND_PROPERTY\n`, {
    networkText: true,
  })
  return { errors: r.errors.map((e) => e.message), unit: r.units[1] as Property }
}

test("the modifiers are kept as an ordered list, as written", () => {
  const r = property("PROPERTY PUBLIC FINAL P : INT")
  expect([r.errors, r.unit.modifiers]).toEqual([[], ["PUBLIC", "FINAL"]])
})

test("an access modifier after another modifier is refused as an unexpected token, then the `;` wanted in place of the name", () => {
  // `unit_property_modifiers_reordered`: "Unexpected token 'PUBLIC' found", both vendors
  expect(property("PROPERTY FINAL PUBLIC P : INT").errors).toEqual(["Unexpected token 'PUBLIC' found", "';' expected instead of 'P'"])
})

test("a PROPERTY takes ONE of FINAL/ABSTRACT, after its access modifier: a second modifier after one is refused", () => {
  // `unit_property_abstract_final`, `unit_property_final_twice` (CODESYS 2026-10-01): "Unexpected token 'FINAL' found" —
  // where a METHOD builds `FINAL FINAL` and calls `ABSTRACT FINAL` a semantic error
  for (const header of ["PROPERTY ABSTRACT FINAL P : INT", "PROPERTY FINAL FINAL P : INT"])
    expect([header, property(header).errors]).toEqual([header, ["Unexpected token 'FINAL' found", "';' expected instead of 'P'"]])
  expect(property("PROPERTY PUBLIC ABSTRACT P : INT").errors).toEqual([])
})
