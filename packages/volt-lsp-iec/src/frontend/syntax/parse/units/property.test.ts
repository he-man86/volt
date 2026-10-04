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
  expect(property("PROPERTY FINAL PUBLIC P : INT").errors).toEqual([
    "Unexpected token 'PUBLIC' found",
    "';' expected instead of 'P'",
  ])
})

test("a PROPERTY takes ONE of FINAL/ABSTRACT, after its access modifier: a second modifier after one is refused", () => {
  // `unit_property_abstract_final`, `unit_property_final_twice` (CODESYS 2026-10-01): "Unexpected token 'FINAL' found" —
  // where a METHOD builds `FINAL FINAL` and calls `ABSTRACT FINAL` a semantic error
  for (const header of ["PROPERTY ABSTRACT FINAL P : INT", "PROPERTY FINAL FINAL P : INT"])
    expect([header, property(header).errors]).toEqual([
      header,
      ["Unexpected token 'FINAL' found", "';' expected instead of 'P'"],
    ])
  expect(property("PROPERTY PUBLIC ABSTRACT P : INT").errors).toEqual([])
})

/**
 * THE ACCESSOR CELLS OF U16 ARE VOLT'S FORMAT, NOT A VENDOR'S TEXT (frontend-conformance 2.10). In both IDEs a getter and
 * a setter are objects of their own, with a declaration of their own; one file holding `GET … END_GET` is how Volt writes
 * them, and what the push reads back (`StReader.ReadProperty`) is the rule. An accessor's DECLARATION is every line under
 * its keyword line — so its access modifier is written on the line UNDER `GET` (`GET\nPUBLIC\nVAR …`, as the pull writes
 * it: 39 such lines in pro2193), and the keyword line itself is dropped whole. A `GET` without its END_GET is a BARE
 * accessor, present and empty, closed at its own line. So a modifier on the keyword's own line, and code under an
 * accessor left open, never reach the IDE: the parser refuses both by name rather than reading what the push drops (0 of
 * either in the corpora — every one of their 366 GET and 86 SET lines is closed and stands alone on its line). No
 * recording can answer these — `unit_property_accessor_modifier`, `_no_end_get`, `_no_end_get_alone` are unaskable.
 */
const accessors = (text: string) => {
  const r = parseSource(
    `FUNCTION_BLOCK X\nVAR\n\tstored : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\n${text}END_PROPERTY\n`,
    {
      networkText: true,
    },
  )
  return { errors: r.errors.map((e) => e.message), unit: r.units[1] as Property }
}

test("an accessor's modifier on the keyword's own line is refused; on the line under it, it is the accessor's declaration", () => {
  const sameLine = accessors("GET PRIVATE\nP := stored;\nEND_GET\n")
  expect(sameLine.errors).toEqual([
    "'GET PRIVATE': the push reads an accessor's modifier from the line under GET, as the pull writes it, and drops GET's own line — it would reach the IDE as 'GET'. Move the modifier to the next line.",
  ])
  // kept in the AST as written, so the formatter prints back what the file says
  expect(sameLine.unit.getter?.modifiers).toEqual(["PRIVATE"])
  expect(accessors("SET PUBLIC FINAL\nstored := P;\nEND_SET\n").errors).toEqual([
    "'SET PUBLIC FINAL': the push reads an accessor's modifier from the line under SET, as the pull writes it, and drops SET's own line — it would reach the IDE as 'SET'. Move the modifier to the next line.",
  ])
  // the pulled form: the modifier opens the accessor's declaration
  const pulled = accessors("GET\nPUBLIC\nVAR\nEND_VAR\nIMPLEMENTATION ST\nP := stored;\nEND_GET\n")
  expect([pulled.errors, pulled.unit.getter?.modifiers]).toEqual([[], ["PUBLIC"]])
})

test("an accessor without END_GET/END_SET is bare: code under it is refused, the bare keyword is not", () => {
  const unclosed = (keyword: string, end: string) =>
    `'${keyword}' is not closed by '${end}': an accessor without its ${end} is bodiless, and the push drops what stands under it. Close it with ${end}.`
  // a getter left open before a setter, and alone before END_PROPERTY
  expect(accessors("GET\nP := stored;\nSET\nstored := P;\nEND_SET\n").errors).toEqual([unclosed("GET", "END_GET")])
  expect(accessors("GET\nP := stored;\n").errors).toEqual([unclosed("GET", "END_GET")])
  // a setter left open
  expect(accessors("SET\nstored := P;\n").errors).toEqual([unclosed("SET", "END_SET")])
  // a declaration under an open accessor is dropped the same way
  expect(accessors("GET\nVAR\n\tt : INT;\nEND_VAR\n").errors).toEqual([unclosed("GET", "END_GET")])
  // the bare keyword — present, empty — is what the push reads it as, and is accepted
  for (const text of ["GET\n", "SET\n", "GET\nSET\n", "GET\nEND_GET\nSET\n"])
    expect([text, accessors(text).errors]).toEqual([text, []])
  const both = accessors("GET\nSET\n").unit
  const code = (a: Property["getter"]) => a?.body?.tokens.filter((t) => t.kind !== "whitespace").length
  expect([code(both.getter), code(both.setter)]).toEqual([0, 0])
})

test("a modifier under a bare accessor is code under an open accessor: refused, as the push drops its line", () => {
  // `StReader.ReadProperty` closes the bare GET at its own line and the property's declaration ends before it, so the
  // PUBLIC line belongs to nothing
  expect(accessors("GET\nPUBLIC\nSET\nIMPLEMENTATION ST\nstored := P;\nEND_SET\n").errors).toEqual([
    "'GET' is not closed by 'END_GET': an accessor without its END_GET is bodiless, and the push drops what stands under it. Close it with END_GET.",
  ])
})

/**
 * The push reads GET, SET, END_GET and END_SET only at the START of a line (`StReader.LineStartsWithKeyword`), and drops
 * the rest of an accessor's keyword line (`ParseAccessor` strips the first and last line whole). So an accessor keyword
 * that does not start its line is never seen — `P := stored; END_GET` leaves the getter open, closed bare, its body
 * dropped; `END_GET SET` never opens the setter, and a null setter REMOVES it in the IDE — and what follows GET/SET on
 * its line never arrives. 0 such lines in the six corpora; refused by name.
 */
test("an accessor keyword stands alone on its line: one that shares it is refused by name", () => {
  const notFirst = (keyword: string, before: string) =>
    `'${keyword}' does not start its line (after '${before}'): the push reads GET, SET, END_GET and END_SET only at the start of a line, so it would not see this one and the accessor's text is lost. Put '${keyword}' on a line of its own.`
  const trailing = (keyword: string, after: string) =>
    `'${after}' shares the line of '${keyword}': the push drops the rest of an accessor's keyword line. Move it to the next line.`
  expect(accessors("GET\nIMPLEMENTATION ST\nP := stored; END_GET\n").errors).toEqual([notFirst("END_GET", ";")])
  expect(
    accessors("GET\nIMPLEMENTATION ST\nP := 1;\nEND_GET SET\nIMPLEMENTATION ST\nstored := P;\nEND_SET\n").errors,
  ).toEqual([notFirst("SET", "END_GET")])
  expect(accessors("SET\nIMPLEMENTATION ST\nstored := P; END_SET\n").errors).toEqual([notFirst("END_SET", ";")])
  expect(accessors("GET P := stored;\nEND_GET\n").errors).toEqual([trailing("GET", "P")])
  expect(accessors("GET END_GET\n").errors).toEqual([notFirst("END_GET", "GET")])
  // each on a line of its own (trailing comments are no content) is accepted
  expect(
    accessors("GET // the getter\nIMPLEMENTATION ST\nP := stored;\nEND_GET (* end *)\nSET\nEND_SET\n").errors,
  ).toEqual([])
})

test("a header with no type keeps its accessors: one message, the build's own, never a 'GET after the unit' the push would refuse", () => {
  // openspec bridge-refusal-review 2.6: the push writes `PROPERTY P` (no colon) as sent, so the LSP's old cascade — "':'
  // expected instead of 'GET'" and a stray GET "the push refuses" — claimed a refusal that no longer happens. Both
  // vendors answer it with a cascade over the declaration they synthesize (`rcc_property_no_type`): a known divergence,
  // but the one message the LSP gives is one BOTH builds give — never the METHOD rule's "instead of ''" (review 5+6).
  const r = property("PROPERTY P")
  expect(r.errors).toEqual(["',, AT or :' expected instead of ';'"])
  expect(r.unit.kind).toBe("property")
  expect(r.unit.getter).toBeDefined()
  // a header that breaks off before anything a property can hold still wants its colon
  expect(property("PROPERTY P INT").errors[0]).toBe("':' expected instead of 'INT'")
})

test("a header ending at its colon is the build's \"Type definition expected instead of ';'\" (rcc_property_empty_type, both vendors)", () => {
  // the METHOD rule's "instead of ''" (`sig_empty_type`) is not what either build says for a PROPERTY: the vendor puts the
  // declaration it synthesizes for the getter after the colon, and its first token is the ';' (review 5+6)
  const r = property("PROPERTY P :")
  expect(r.errors).toEqual(["Type definition expected instead of ';'"])
  expect(r.unit.getter).toBeDefined()
})
