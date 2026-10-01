/**
 * THE METHOD HEADER (design.md §4 2.4, U11–U13), as both vendors read it (`fixtures/grammar/units.ts`, recorded
 * 2026-10-01): its modifiers in order as written, and an access modifier only in first place.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { Method } from "../../ast/nodes.js"

const method = (header: string) => {
  const r = parseSource(`FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK\n\n${header}\nM := 7;\nEND_METHOD\n`, { networkText: true })
  return { errors: r.errors.map((e) => e.message), unit: r.units[1] as Method }
}

test("the modifiers are kept as an ordered list, as written", () => {
  expect(method("METHOD PUBLIC FINAL M : INT").unit.modifiers).toEqual(["PUBLIC", "FINAL"])
  expect(method("METHOD PROTECTED ABSTRACT M : INT").unit.modifiers).toEqual(["PROTECTED", "ABSTRACT"])
  // a repeated FINAL builds on both vendors (`unit_method_modifier_twice`)
  const twice = method("METHOD FINAL FINAL M : INT")
  expect([twice.errors, twice.unit.modifiers]).toEqual([[], ["FINAL", "FINAL"]])
})

test("an access modifier after another modifier is refused where a name stands", () => {
  // `unit_method_final_private_order`, `unit_method_two_access`: "Identifier expected instead of 'PRIVATE'", both vendors
  for (const header of ["METHOD FINAL PRIVATE M : INT", "METHOD PUBLIC PRIVATE M : INT"]) {
    const r = method(header)
    expect([header, r.errors[0]]).toEqual([header, "Identifier expected instead of 'PRIVATE'"])
  }
})

test("a modifier word alone before the name is the name (`METHOD PROTECTED Final`)", () => {
  const r = method("METHOD PROTECTED Final : INT")
  expect([r.errors, r.unit.name.text, r.unit.modifiers]).toEqual([[], "Final", ["PROTECTED"]])
})

test("OVERRIDE is no modifier: `METHOD OVERRIDE M` is a method NAMED Override", () => {
  // `unit_method_override` (record:exec, CODESYS 2026-10-01): "The name used in the signature is not identical to the
  // object name" — the vendor took OVERRIDE for the name, and `M : INT` for what follows it (the body parser's)
  const r = method("METHOD OVERRIDE M : INT")
  expect([r.unit.name.text, r.unit.modifiers]).toEqual(["OVERRIDE", []])
})
