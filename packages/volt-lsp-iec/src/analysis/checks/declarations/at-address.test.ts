/**
 * at-address — C0030. An AT clause whose operand isn't a direct address. Wording verified live against
 * CODESYS 3.5.21: "Direct address expected after AT instead of <token>".
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

function at(src: string) {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
    (d) => d.code === "at-address",
  )
}
const prg = (decl: string) => `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\nEND_PROGRAM`

test("an AT operand that is an identifier is flagged, byte-identical to CODESYS", () => {
  const d = at(prg("i AT ABC : INT;"))
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("error")
  expect(d[0]?.message).toBe("Direct address expected after AT instead of ABC")
})

test("a valid direct address is not flagged", () => {
  expect(at(prg("di AT %IB8 : BYTE;"))).toEqual([])
  expect(at(prg("b AT %IX0.0 : BOOL;"))).toEqual([])
  expect(at(prg("m AT %I* : BYTE;"))).toEqual([]) // memory-mapped placeholder
})

test("AT after the type (alternative position) is also validated", () => {
  expect(at(prg("i : INT AT ABC;"))).toHaveLength(1)
  expect(at(prg("i : INT AT %MB100;"))).toEqual([])
})

test("a var with no AT clause is untouched", () => {
  expect(at(prg("i : INT;"))).toEqual([])
})

function all(src: string, vendor: "codesys" | "twincat" = "codesys") {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], undefined, vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
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
