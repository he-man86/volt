/**
 * unexpected-struct-init (C0076). A struct-literal `(field := …)` initializer on an elementary type. Docs
 * wording (#C0076). Sibling of C0074 (array literal on non-array).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const init = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE S : STRUCT p1 : INT; p2 : INT; END_STRUCT END_TYPE`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unexpected-struct-init")
    .map((d) => d.message)
}

test("a struct initializer on an elementary type is flagged (single and multi-field)", () => {
  expect(init(`  x : INT := (p1 := 1);`)).toEqual(["Unexpected structure initialisation"])
  expect(init(`  x : INT := (p1 := 1, p2 := 2);`)).toEqual(["Unexpected structure initialisation"])
})

test("a struct initializer on a struct stays quiet (0-FP)", () => {
  expect(init(`  s : S := (p1 := 1);`)).toEqual([]) // valid struct init
  expect(init(`  s : S := (p1 := 1, p2 := 2);`)).toEqual([])
})

test("grouping parens and scalar inits are not struct inits (0-FP)", () => {
  expect(init(`  x : INT := (5);`)).toEqual([]) // grouping, not a field assignment
  expect(init(`  x : INT := (2 + 3);`)).toEqual([])
  expect(init(`  x : INT := 5;`)).toEqual([])
})

test("byte-identical on both vendors", () => {
  expect(init(`  x : INT := (p1 := 1);`, "twincat")).toEqual(init(`  x : INT := (p1 := 1);`, "codesys"))
})
