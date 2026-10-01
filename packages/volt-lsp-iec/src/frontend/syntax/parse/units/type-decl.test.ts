/**
 * THE TYPE HEADER AND ITS ENDS (design.md §4 2.4, U22–U27), as both vendors read them (`fixtures/grammar/units.ts`,
 * recorded 2026-10-01): EXTENDS in one place, the `;` before END_TYPE per body kind, a refused token consumed and the
 * end of the object quoted as '', and a type whose body was refused kept — bodiless, never an invented alias.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { TypeDecl } from "../../ast/nodes.js"

const parse = (src: string) => {
  const r = parseSource(src, { networkText: true })
  return { errors: r.errors.map((e) => e.message), units: r.units }
}
const type = (src: string) => {
  const r = parse(src)
  return { errors: r.errors, unit: r.units[0] as TypeDecl }
}

test("EXTENDS stands between the name and the colon, and names one base", () => {
  const ok = type("TYPE X EXTENDS B :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")
  expect(ok.errors).toEqual([])
  expect(ok.unit.body.kind === "struct" && ok.unit.body.extends?.text).toBe("B")
  // `unit_struct_extends_after_struct`: EXTENDS after STRUCT is the field parser's refusal
  expect(type("TYPE X :\nSTRUCT EXTENDS B\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n").errors[0]).toBe("Unexpected token 'EXTENDS' found")
  // `unit_struct_extends_list`: no list — the colon was due, and the header is skipped through the next `;`
  const list = type("TYPE X EXTENDS A, B :\nSTRUCT\n\tc : INT;\nEND_STRUCT\nEND_TYPE\n")
  expect(list.errors).toEqual(["':' expected instead of ','", "'END_TYPE' expected instead of 'END_STRUCT'"])
  expect([list.unit.body.kind, list.unit.extendsMisused?.text]).toEqual(["refused", "A"])
})

test("a missing colon wants `: or EXTENDS` where no EXTENDS was written, and the type is kept bodiless", () => {
  // `unit_type_missing_colon`
  const r = type("TYPE X\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")
  expect(r.errors).toEqual(["': or EXTENDS' expected instead of 'STRUCT'", "'END_TYPE' expected instead of 'END_STRUCT'"])
  expect([r.unit.name.text, r.unit.body.kind]).toEqual(["X", "refused"])
})

test("a TYPE with nothing after its colon: the refused END_TYPE is consumed, and the end of the object is ''", () => {
  // `unit_type_no_body`, both vendors' three messages; no alias of a type named `?`
  const r = type("TYPE X :\nEND_TYPE\n")
  expect(r.errors).toEqual([
    "Type definition expected instead of 'END_TYPE'",
    "':= or ;' expected instead of ''",
    "'END_TYPE' expected instead of ''",
  ])
  expect(r.unit.body.kind).toBe("refused")
})

test("the `;` before END_TYPE: an alias requires it, an enum takes it, a STRUCT and a UNION refuse it", () => {
  // `unit_alias_no_semicolon`
  expect(type("TYPE A : INT\nEND_TYPE\n").errors).toEqual([
    "':= or ;' expected instead of 'END_TYPE'",
    "'END_TYPE' expected instead of ''",
  ])
  expect(type("TYPE A : INT;\nEND_TYPE\n").errors).toEqual([])
  expect(type("TYPE E :\n(\n\tVA,\n\tVB\n);\nEND_TYPE\n").errors).toEqual([])
  // `unit_struct_end_semicolon`, `unit_union_end_semicolon`: one message, the `;` consumed
  expect(type("TYPE S :\nSTRUCT\n\ta : INT;\nEND_STRUCT;\nEND_TYPE\n").errors).toEqual(["'END_TYPE' expected instead of ';'"])
  expect(type("TYPE U :\nUNION\n\ta : INT;\nEND_UNION;\nEND_TYPE\n").errors).toEqual(["'END_TYPE' expected instead of ';'"])
})

test("the next unit's start is the end of the object, and is never consumed", () => {
  const r = parse("TYPE A : INT\nEND_TYPE\n\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\n")
  expect(r.errors).toEqual(["':= or ;' expected instead of 'END_TYPE'", "'END_TYPE' expected instead of ''"])
  expect(r.units.map((u) => u.kind)).toEqual(["type_decl", "function_block"])
})
