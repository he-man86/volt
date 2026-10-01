/**
 * refused-initializer — a declaration whose initializer the PARSER refused (`VarDecl.refusedInit`: a malformed literal
 * leads it) has the compiler's placeholder for a value, and the type check says so. The whole answer, both vendors,
 * every recorded cell (`cc_time_microsecond_literal`, `esc_wstring_hex_41`, `_ff`, `_pair`, `hex3`; 2026-09-20/21):
 *
 *   ';' expected instead of 'X'                                            the parser
 *   Expression expected instead of 'X'                                     the parser
 *   Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'T'         this check
 *
 * (This was `time-literal-unit` and `wstring-escape`, two analysis checks that re-lexed what the lexer now refuses.)
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(decl: string, vendor: Vendor = "codesys"): string[] {
  const src = `FUNCTION_BLOCK F\nVAR\n\t${decl}\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort() // the parser's two and the type check's one arrive from two passes; the recordings are compared sorted too
}
const refused = (text: string, type: string) =>
  [
    `';' expected instead of '${text}'`,
    `Expression expected instead of '${text}'`,
    `Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type '${type}'`,
  ].sort()

test("a WSTRING with a short hex escape, and a TIME with a unit it does not have, leading an initializer", () => {
  expect(msgs('v : WSTRING := "$41";')).toEqual(refused('"$41"', "WSTRING"))
  expect(msgs('v : WSTRING := "$004";')).toEqual(refused('"$004"', "WSTRING"))
  expect(msgs('v : WSTRING := "$C3$A9";')).toEqual(refused('"$C3$A9"', "WSTRING"))
  expect(msgs("t : TIME := T#1500US;")).toEqual(refused("T#1500", "TIME"))
})

test("TwinCAT quotes the literal only as far as it lexed it", () => {
  const tc = msgs('v : WSTRING := "$C3$A9";', "twincat")
  expect(tc).toContain(`';' expected instead of '"$C3'`)
  expect(tc).toContain(`Expression expected instead of '"$C3'`)
})

test("four hex digits, the named escapes, and a STRING's two digits are values, not refusals", () => {
  for (const ok of ['"abc"', '"$0041"', '"$00FF"', '"$20AC"', '"a$0041b"', '"$00041"', '"$$"', '"$N"', '"a$Tb"'])
    expect(msgs(`v : WSTRING := ${ok};`)).toEqual([])
  for (const ok of ["'$41'", "'$FF'", "'$C3$A9'"]) expect(msgs(`v : STRING := ${ok};`)).toEqual([])
  expect(msgs("t : LTIME := LTIME#1500US;")).toEqual([])
})

test("a refused literal AFTER an operator: the value is the expression around the placeholder (both vendors)", () => {
  // `lit_init_malformed_not_leading` (CODESYS and TwinCAT, 2026-10-01): the operand that is the placeholder has no type
  // either, as `unknown-source` reports an operand hole
  for (const vendor of ["codesys", "twincat"] as const)
    expect(msgs("v : INT := 1 + 3#12;", vendor)).toEqual(
      [
        "';' expected instead of '3#'",
        "Expression expected instead of '3#'",
        "Cannot convert type 'Unknown type: '(1 + !!!'ERROR'!!!)'' to type 'INT'",
        "Unknown type: '!!!'ERROR'!!!'",
      ].sort(),
    )
})

test("`BOOL#TRUE` leading an initializer: the pair on `BOOL#T`, nothing about `RUE`", () => {
  // `lit_init_bool_typed_true`, both vendors
  expect(msgs("v : BOOL := BOOL#TRUE;")).toEqual(refused("BOOL#T", "BOOL"))
})

test("a refused literal inside an aggregate initializer: the aggregate wants its `,` or `]`, and there is no value", () => {
  // `lit_init_malformed_in_aggregate`, both vendors — the "END_VAR" cascade after it is recovery (task 2.8)
  const got = msgs("a : ARRAY[0..1] OF TIME := [T#1s, T#1500US];")
  expect(got).toContain("',, ( or ]' expected instead of 'T#1500'")
  expect(got).toContain("Expression expected instead of 'T#1500'")
  expect(got.filter((m) => m.startsWith("Cannot convert") || m.startsWith("';' expected instead of 'T#1500'"))).toEqual([])
})
