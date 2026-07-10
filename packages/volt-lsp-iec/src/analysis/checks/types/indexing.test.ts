/**
 * indexing-non-array (C0047). `[]` applied to a value whose type is not indexable. Docs wording (#C0047);
 * provisional until a live recording locks it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const idx = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  i : INT; re : REAL; str : STRING;\n  arr : ARRAY[0..2] OF INT; pt : POINTER TO INT;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "indexing-non-array")
    .map((d) => d.message)
}

test("indexing a scalar names its type", () => {
  expect(idx(`i[1];`)).toEqual(["Cannot apply indexing with [] to an expression of type 'INT'"])
  expect(idx(`re[0];`)).toEqual(["Cannot apply indexing with [] to an expression of type 'REAL'"])
})

test("indexable bases stay quiet (0-FP): arrays, pointers, strings", () => {
  expect(idx(`i := arr[1];`)).toEqual([]) // array
  expect(idx(`i := pt[0];`)).toEqual([]) // pointer arithmetic
  expect(idx(`str[1];`)).toEqual([]) // string char indexing — a grey area we don't decide offline
})

test("C0126: a pointer indexed with a count other than 1 is flagged; one index is fine", () => {
  const run = (body: string) => {
    const src = `PROGRAM PLC_PRG\nVAR\n  pt : POINTER TO INT; i : INT;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "pointer-index-arity")
      .map((d) => d.message)
  }
  expect(run(`i := pt[1,2];`)).toEqual(["Variable of type 'POINTER TO INT' requires exactly 1 Index"])
  expect(run(`i := pt[1];`)).toEqual([])
})

test("C0048: a multi-dim array indexed with the wrong number of indices is flagged", () => {
  const run = (decl: string, body: string) => {
    const src = `FUNCTION_BLOCK F\nVAR ${decl} i : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "array-index-count")
      .map((d) => d.message)
  }
  expect(run(`a : ARRAY[1..2,1..3] OF INT;`, `i := a[1];`)).toEqual(["Array requires exactly 2 indexes"])
  expect(run(`a : ARRAY[1..2,1..3] OF INT;`, `i := a[1,2];`)).toEqual([]) // full index set
  expect(run(`a : ARRAY[1..2] OF ARRAY[1..3] OF INT;`, `i := a[1][2];`)).toEqual([]) // array-of-array, 1 dim each
})

test("byte-identical on both vendors", () => {
  expect(idx(`i[1];`, "twincat")).toEqual(idx(`i[1];`, "codesys"))
})
