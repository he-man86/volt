/**
 * unexpected-struct-init (C0076). A struct-literal `(field := …)` initializer on an elementary type, and the cascade
 * that follows it: the compiler resolves each FIELD NAME against the POU's own scope, where a struct's fields are not.
 * Sibling of C0074 (array literal on non-array).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const init = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE sv : STRUCT p1 : INT; p2 : INT; END_STRUCT END_TYPE`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unexpected-struct-init")
    .map((d) => d.message)
}

test("a struct initializer on an elementary type is flagged (single and multi-field), with its cascade", () => {
  expect(init(`  x : INT := (p1 := 1);`)).toEqual([
    "Unexpected structure initialisation",
    "Identifier 'p1' not defined",
    "'p1' is no valid assignment target",
    "Cannot convert type 'Unknown type: 'STRUCT(p1 := 1)'' to type 'INT'",
  ])
  expect(init(`  x : INT := (p1 := 1, p2 := 2);`)).toEqual([
    "Unexpected structure initialisation",
    "Identifier 'p1' not defined",
    "'p1' is no valid assignment target",
    "Identifier 'p2' not defined",
    "'p2' is no valid assignment target",
    "Cannot convert type 'Unknown type: 'STRUCT(p1 := 1, p2 := 2)'' to type 'INT'",
  ])
})

test("a struct initializer on a struct stays quiet (0-FP)", () => {
  expect(init(`  sv : sv := (p1 := 1);`)).toEqual([]) // valid struct init
  expect(init(`  sv : sv := (p1 := 1, p2 := 2);`)).toEqual([])
})

test("grouping parens and scalar inits are not struct inits (0-FP)", () => {
  expect(init(`  x : INT := (5);`)).toEqual([]) // grouping, not a field assignment
  expect(init(`  x : INT := (2 + 3);`)).toEqual([])
  expect(init(`  x : INT := 5;`)).toEqual([])
})

test("byte-identical on both vendors", () => {
  expect(init(`  x : INT := (p1 := 1);`, "twincat")).toEqual(init(`  x : INT := (p1 := 1);`, "codesys"))
})

test("the compiler resolves each FIELD NAME against the POU's scope, where they are not", () => {
  // Why missed: only the "unexpected" sentence was emitted, so six of the seven errors CODESYS gives for
  // `otherWay : INT := (x := 1, y := 2)` were missing (conformance `cc3_unexpected_struct_init`).
  const src = `TYPE DUT_P :\nSTRUCT\nx : INT;\ny : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK F\nVAR\notherWay : INT := (x := 1, y := 2);\nEND_VAR\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "a.fb", parseResult: pr, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "unexpected-struct-init")
    .map((d) => d.message)
    .sort()
  expect(msgs).toEqual([
    "'x' is no valid assignment target",
    "'y' is no valid assignment target",
    "Cannot convert type 'Unknown type: 'STRUCT(x := 1, y := 2)'' to type 'INT'",
    "Identifier 'x' not defined",
    "Identifier 'y' not defined",
    "Unexpected structure initialisation",
  ])
})
