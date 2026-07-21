/**
 * constant-too-large (C0001). Only PROVABLE overflows — a literal no type can hold — are flagged; a value
 * that merely doesn't fit the assignment target is C0032's job, not this. Docs wording (13-error-messages
 * #C0001).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const overflow = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  i : INT;\n  r : LREAL;\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "constant-too-large")
    .map((d) => d.message)
}

test("the three documented cases (typed / ANY_INT / ANY_REAL)", () => {
  expect(overflow(`i := INT#123456;`)).toEqual(["Constant 'INT#123456' too large for type 'INT'"])
  expect(overflow(`i := 12345678912345566991923939292939911;`)).toEqual([
    "Constant '12345678912345566991923939292939911' too large for type 'ANY_INT'",
  ])
  expect(overflow(`r := 10E500;`)).toEqual(["Constant '10E500' too large for type 'ANY_REAL'"])
})

test("a typed literal past a narrower prefix names that prefix", () => {
  expect(overflow(`i := SINT#200;`)).toEqual(["Constant 'SINT#200' too large for type 'SINT'"])
  expect(overflow(`i := WORD#16#10000;`)).toEqual(["Constant 'WORD#16#10000' too large for type 'WORD'"])
})

test("a typed REAL literal past REAL magnitude names REAL", () => {
  expect(overflow(`r := REAL#1E40;`)).toEqual(["Constant 'REAL#1E40' too large for type 'REAL'"])
})

test("variable initializers are checked too", () => {
  const src = `FUNCTION_BLOCK F\nVAR x : INT := INT#99999; END_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "constant-too-large")
    .map((d) => d.message)
  expect(msgs).toEqual(["Constant 'INT#99999' too large for type 'INT'"])
})

test("representable constants stay quiet (0-FP)", () => {
  expect(overflow(`i := INT#123;`)).toEqual([]) // fits INT
  expect(overflow(`i := 999;`)).toEqual([]) // fits DINT — not this check's error (C0032 at most)
  expect(overflow(`r := 1E38;`)).toEqual([]) // fits LREAL
  expect(overflow(`i := 18446744073709551615;`)).toEqual([]) // exactly ULINT max
})

test("byte-identical on both vendors", () => {
  expect(overflow(`i := INT#123456;`, "twincat")).toEqual(overflow(`i := INT#123456;`, "codesys"))
})
