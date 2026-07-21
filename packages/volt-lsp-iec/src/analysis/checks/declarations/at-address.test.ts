/**
 * at-address — C0030. An AT clause whose operand isn't a direct address. Wording verified live against
 * CODESYS 3.5.21: "Direct address expected after AT instead of <token>".
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

function at(src: string) {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
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
