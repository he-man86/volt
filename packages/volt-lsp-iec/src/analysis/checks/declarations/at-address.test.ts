/**
 * at-address — C0030. An AT clause whose operand isn't a direct address: the PARSER refuses it ("Direct address expected
 * after AT instead of <token>", `parse/declarations`), and this check reports the lost declaration's uses; a malformed
 * address is named here and the declaration stands.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

function at(src: string) {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
    (d) => d.code === "at-address",
  )
}
const prg = (decl: string) => `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\nEND_PROGRAM`

function all(src: string, vendor: "codesys" | "twincat" = "codesys") {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], undefined, vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}
const fbWith = (decl: string, body: string) => `FUNCTION_BLOCK F\nVAR\n\t${decl}\n\tout : WORD;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`

test("an AT address with a size and no position is no address, and the declaration is lost (A2)", () => {
  // `lit_address_incomplete_sized` (`%IW*`) and `lit_address_no_position` (`%MW`), both vendors 2026-10-01
  const lost = ["Cannot convert type 'Unknown type: 'w'' to type 'WORD'", "Identifier 'w' not defined"]
  expect(all(fbWith("w AT %IW* : WORD;", "out := w;"))).toEqual([...lost, "Direct address expected after AT instead of %IW"].sort())
  expect(all(fbWith("w AT %MW : WORD;", "out := w;"))).toEqual([...lost, "Direct address expected after AT instead of %MW"].sort())
  expect(all(fbWith("w AT %MW : WORD;", "out := w;"), "twincat")).toContain('Direct Address expected after "AT" instead of %MW')
})

test("an AT address of the wrong shape is malformed, echoed as the vendor echoes it, and the declaration stands (A1, A2)", () => {
  // `lit_address_unsized*`, `lit_address_bit_no_bit`, `_bit_three_segments`, `_two_segments`, `_multi_segment`
  expect(all(fbWith("b AT %I0.0 : BOOL;", "out := 1;"))).toEqual(["Direct address '%I?0.0' malformed"])
  expect(all(fbWith("b AT %M0 : BOOL;", "out := 1;"))).toEqual(["Direct address '%M?0' malformed"])
  expect(all(fbWith("b AT %MX1.2.3 : BOOL;", "out := 1;"))).toEqual(["Direct address '%MX1.2.3' malformed"])
  expect(all(fbWith("w AT %IW2.5.7.1 : WORD;", "out := w;"))).toEqual(["Direct address '%IW2.5.7.1' malformed"])
  expect(all(fbWith("b AT %I0.0 : BOOL;", "out := 1;"), "twincat")).toEqual(["Direct Address '%I?0.0' malformed"])
  // and the shapes that build: `%MX10.8` (the bit is not checked against a byte), `%ML1`, lower case, `%I*`
  for (const a of ["%MX10.8", "%ML1", "%mx9.2", "%I*", "%Q*", "%M*"]) expect(all(fbWith(`b AT ${a} : BOOL;`, "out := 1;"))).toEqual([])
})

/** A body that writes and reads `v`. */
const BODY = "v := 5;\nout := v;"

test("an AT operand that is no address is refused, and every use of the declaration is lost (D11)", () => {
  // `cc5_at_address_not_direct` (a name), `decl_at_not_an_address` (an integer), `_string`, `decl_at_empty` (no operand),
  // both vendors 2026-10-01 — the vendor echoes the operand as written, or the `:` where there is none
  const lost = ["'v' is no valid assignment target", "Cannot convert type 'Unknown type: 'v'' to type 'WORD'", "Identifier 'v' not defined", "Identifier 'v' not defined"]
  for (const [operand, echo] of [["ABC", "ABC"], ["16#10", "16#10"], ["'x'", "'x'"], ["", ":"]] as const)
    expect(all(fbWith(`v AT ${operand} : WORD;`, BODY))).toEqual([...lost, `Direct address expected after AT instead of ${echo}`].sort())
  expect(all(fbWith("v AT 16#10 : WORD;", "out := 1;"), "twincat")).toEqual(['Direct Address expected after "AT" instead of 16#10'])
})

test("AT after the type is no grammar: the declaration stands without it (D10)", () => {
  // `decl_at_after_type`, `_with_init`, `decl_at_twice`, `decl_at_not_an_address_after_type`, both vendors 2026-10-01
  const refused = ["';, :=, REF=, ( or [' expected instead of 'AT'"]
  expect(all(fbWith("v : WORD AT %MW42;", BODY))).toEqual(refused)
  expect(all(fbWith("v : WORD AT %MW44 := 6;", "out := v;"))).toEqual(refused)
  expect(all(fbWith("v AT %MW46 : WORD AT %MW48;", BODY))).toEqual(refused)
  expect(all(fbWith("v : WORD AT abc;", BODY))).toEqual(refused)
})
