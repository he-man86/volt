/**
 * THE PROGRAM AND FUNCTION HEADERS (design.md §4 2.4, U1–U4), as both vendors read them (`fixtures/grammar/units.ts`,
 * recorded 2026-10-01).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../parser.js"
import type { Function as FunctionAST, Program } from "../../ast/nodes.js"

const parse = (src: string) => {
  const r = parseSource(src, { networkText: true })
  return { errors: r.errors.map((e) => e.message), units: r.units }
}

test("a PROGRAM header may end in `;` (`PROGRAM P;`) — its declarations are read after it", () => {
  // `unit_program_trailing_semicolon` builds on both vendors
  const r = parse("PROGRAM P;\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := 3;\nEND_PROGRAM\n")
  expect(r.errors).toEqual([])
  expect((r.units[0] as Program).varSections[0]?.decls.map((d) => d.names[0]?.text)).toEqual(["out"])
})

test("a FUNCTION reads no IMPLEMENTS after its return type — the clause stands only after the name", () => {
  // `unit_function_implements`: `FUNCTION F : INT IMPLEMENTS I` is "Unexpected token 'IMPLEMENTS' found" on both vendors,
  // not the C0145 a clause after the name gets (`hdr_function_implements_no_return`)
  const after = parse("FUNCTION F : INT IMPLEMENTS I\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF := x;\nEND_FUNCTION\n")
  expect((after.units[0] as FunctionAST).implementsMisused).toBeUndefined()
  expect(after.errors[0]).toBe("Unexpected token 'IMPLEMENTS' found")
  const before = parse("FUNCTION F IMPLEMENTS I\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n")
  expect((before.units[0] as FunctionAST).implementsMisused?.map((i) => i.text)).toEqual(["I"])
})
