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
import { test, expect, describe } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"
import { uriFor } from "../../test-uri.js"

function msgs(decl: string, vendor: Vendor = "codesys"): string[] {
  const src = `FUNCTION_BLOCK F\nVAR\n\t${decl}\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
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

test("a refused word as an initializer's operand is refused as a malformed literal is (rec_refused_word_initializer_alone, rec_refused_word_initializer, both vendors)", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(msgs("x : INT := dint;", vendor)).toEqual(refused("dint", "INT"))
    expect(msgs("x : INT := 1 + word;", vendor)).toEqual(
      [
        "';' expected instead of 'word'",
        "Expression expected instead of 'word'",
        "Cannot convert type 'Unknown type: '(1 + !!!'ERROR'!!!)'' to type 'INT'",
        "Unknown type: '!!!'ERROR'!!!'",
      ].sort(),
    )
  }
})

test("a refused word that is a callee or a lone argument is a name there, as in a body", () => {
  expect(msgs("x : LTIME := LTIME();")).toEqual([])
  expect(msgs("x : DINT := TO_DINT(SIZEOF(DINT));")).toEqual([])
})

test("an unlisted `__` operator leading an initializer — TwinCAT's documented `__TRY_CAST` — is refused on both vendors (rec_dunder_try_cast_initializer)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(msgs("a : POINTER TO INT;\n\tb : POINTER TO INT;\n\tp : POINTER TO INT := __TRY_CAST(a, b);", vendor)).toEqual(refused("__TRY_CAST", "POINTER TO INT"))
})

/**
 * NAMES IN AN INITIALIZER — a `__` name the compiler does not know is a PARSE refusal inside a declaration's
 * initializer (`parse/initializer` `refuseMalformedInit` since frontend-conformance 2.8.3; the analysis check
 * `system-initializer` held it before), and an ordinary undefined identifier anywhere else. Measured on both live IDEs
 * 2026-09-21 (`cc_decl_init_unknown_name`, `cc_decl_init_sibling_var`, `cc_decl_init_dunder_unknown`,
 * `sysop_position_initializer`).
 */
describe("names in an initializer", () => {
  function msgs(src: string, vendor: Vendor, codes?: readonly string[]): string[] {
    const parseResult = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => codes === undefined || codes.includes(d.code))
      .map((d) => d.message)
  }
  const decl = (d: string) => `FUNCTION_BLOCK F\nVAR\n\t${d}\nEND_VAR\nEND_FUNCTION_BLOCK`

  // `__POSITION` is CODESYS's, so CODESYS folds it and TwinCAT lands in the refusal. Same source, two answers,
  // one rule — which is the shape every vendor difference in this repo is supposed to have.
  test("a `__` name the DIALECT lacks is refused by the parser, in an initializer", () => {
    const src = decl("here : DINT := __POSITION;")
    expect(msgs(src, "twincat", ["syntax-error", "refused-initializer"])).toEqual([
      // the analysis says its line before the parse errors are reported (order is no fact the vendors record)
      "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'DINT'",
      "';' expected instead of '__POSITION'",
      "Expression expected instead of '__POSITION'",
    ])
    expect(msgs(src, "codesys", ["syntax-error", "refused-initializer"])).toEqual([])
    // …and one NEITHER dialect has, on both (`cc_decl_init_dunder_unknown`); the `__SYSTEM` namespace is read through its `.`
    for (const vendor of ["codesys", "twincat"] as const) {
      expect(msgs(decl("n : DINT := __NO_SUCH_THING;"), vendor, ["syntax-error", "refused-initializer"])).toEqual([
        "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'DINT'",
        "';' expected instead of '__NO_SUCH_THING'",
        "Expression expected instead of '__NO_SUCH_THING'",
      ])
      expect(msgs(decl("t : __SYSTEM.TYPE_CLASS := __SYSTEM.TYPE_CLASS.TYPE_NONE;"), vendor, ["syntax-error", "refused-initializer"])).toEqual([])
    }
  })

  // …and it is NOT reported as an undefined identifier beside that, because the compiler never gets that far.
  test("the refused name is not also called undefined", () => {
    expect(msgs(decl("here : DINT := __POSITION;"), "twincat", ["unresolved-identifier"])).toEqual([])
    // the SAME name in a BODY is exactly that, though (`sysop_position_bare_statement`)
    const body = `FUNCTION_BLOCK F\nVAR\n\there : DINT;\nEND_VAR\nhere := __POSITION;\nEND_FUNCTION_BLOCK`
    expect(msgs(body, "twincat", ["unresolved-identifier"])).toEqual(["Identifier '__POSITION' not defined"])
  })

  // AN INITIALIZER IS NOT A CONSTANT-ONLY PLACE, which is the reading these cells had to rule out: an ordinary
  // unknown name is an undefined IDENTIFIER there, and a sibling variable is accepted outright.
  test("an ordinary name in an initializer is resolved like any other", () => {
    for (const vendor of ["codesys", "twincat"] as const) {
      expect(msgs(decl("n : DINT := nope;"), vendor, ["unresolved-identifier"])).toEqual(["Identifier 'nope' not defined"])
      expect(msgs(decl("other : DINT;\n\tn : DINT := other;"), vendor, ["unresolved-identifier"])).toEqual([])
      expect(msgs(decl("n : DINT := 7;"), vendor, ["unresolved-identifier", "syntax-error", "refused-initializer"])).toEqual([])
    }
  })

  // THE CORPUS FOUND THIS ONE. `{attribute 'qualified_only'}` governs access from OUTSIDE the list, and `lookup`
  // drops such a symbol at every level including its own — which never mattered while the check walked bodies,
  // because a GVL has no body. Real projects initialize one constant from its neighbours (pro2193's
  // `GVL_Constants`), and CODESYS compiles it.
  test("a qualified_only GVL's own constants resolve bare in each other's initializers", () => {
    const gvl = `{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n\tMaxX : UINT := 3;\n\tMaxY : UINT := 4;\n\tTotal : UINT := MaxX * MaxY;\nEND_VAR`
    expect(msgs(gvl, "codesys", ["unresolved-identifier"])).toEqual([])
  })
})
