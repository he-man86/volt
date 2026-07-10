/**
 * incompatible-comparison (C0066). A relational operator between two mutually-inconvertible scalar types.
 * Docs wording (#C0066); provisional until a live recording locks it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const cmp = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  i : INT; re : REAL; str : STRING; b : BOOL; w : WORD;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "incompatible-comparison")
    .map((d) => d.message)
}

test("comparing a number to a string names both, in source order", () => {
  expect(cmp(`b := i > str;`)).toEqual(["Cannot compare type 'INT' with type 'STRING'"])
  expect(cmp(`b := str < i;`)).toEqual(["Cannot compare type 'STRING' with type 'INT'"])
})

test("comparable pairs stay quiet (0-FP)", () => {
  expect(cmp(`b := i > re;`)).toEqual([]) // int vs real — numeric, convertible
  expect(cmp(`b := i > w;`)).toEqual([]) // int vs bit-string — numeric
  expect(cmp(`b := i = i;`)).toEqual([]) // same type
  expect(cmp(`b := str = str;`)).toEqual([]) // string vs string
})

test("all six relational operators are covered", () => {
  for (const op of ["<", ">", "<=", ">=", "=", "<>"]) expect(cmp(`b := i ${op} str;`)).toHaveLength(1)
})

test("C0068/C0069: comparing arrays is flagged (same type → one, different → two)", () => {
  const src = (d: string) => `PROGRAM PLC_PRG\nVAR\n  b : BOOL; a1 : ARRAY[1..2] OF INT; a2 : ARRAY[1..2] OF INT; a3 : ARRAY[1..3] OF INT;\nEND_VAR\n${d}\nEND_PROGRAM`
  const run = (d: string) => {
    const pr = parseSource(src(d))
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src(d) }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src(d), project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((x) => x.code.startsWith("compare-array"))
      .map((x) => x.message)
  }
  expect(run(`b := a1 > a2;`)).toEqual(["Compare not possible on objects of type 'ARRAY [1..2] OF INT'"])
  expect(run(`b := a1 > a3;`)).toEqual(["Compare not possible on objects of type 'ARRAY [1..2] OF INT' or 'ARRAY [1..3] OF INT'"])
})

test("byte-identical on both vendors", () => {
  expect(cmp(`b := i > str;`, "twincat")).toEqual(cmp(`b := i > str;`, "codesys"))
})

test("C0354: comparing two different enumeration types is flagged; same-enum and enum-vs-int are not", () => {
  const enums = `TYPE ENUM1 : (A, B); END_TYPE\nTYPE ENUM2 : (X, Y); END_TYPE\n`
  const run = (body: string) => {
    const src = `${enums}PROGRAM P\nVAR b : BOOL; e1 : ENUM1; ea : ENUM1; e2 : ENUM2; i : INT;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "enum-comparison")
      .map((d) => d.message)
  }
  expect(run(`b := e1 = e2;`)).toEqual(["Comparison of one enumeration type (ENUM1) with another (ENUM2)"])
  expect(run(`b := e1 = ea;`)).toEqual([]) // same enum type
  expect(run(`b := e1 = i;`)).toEqual([]) // enum vs int — valid
})
