/**
 * array-initializer checks: C0074 unexpected-array-init (array literal on a non-array type) and C0075
 * array-init-count (too many values for a single-dim array). Docs wording; provisional until recording.
 * The declared type is resolved, so array aliases stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const byCode =
  (code: string) =>
  (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
    const src =
      `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\n` +
      `TYPE MyArr : ARRAY[0..2] OF INT; END_TYPE\nTYPE S : STRUCT a : INT; END_STRUCT END_TYPE\n` +
      `TYPE HUE : (RED, GREEN, BLUE); END_TYPE`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const init = byCode("unexpected-array-init")
const count = byCode("array-init-count")
const nesting = byCode("array-init-nesting")
const element = byCode("array-init-element")
const nonConst = byCode("array-init-count-non-const")

test("an array literal on a scalar type is flagged", () => {
  expect(init(`  x : INT := [1,2,3];`)).toEqual(["Unexpected array initialisation"])
})

test("an array literal on an array (direct or aliased) stays quiet (0-FP)", () => {
  expect(init(`  a : ARRAY[0..2] OF INT := [1,2,3];`)).toEqual([]) // direct array
  expect(init(`  a : MyArr := [1,2,3];`)).toEqual([]) // array alias — resolved, not flagged
})

test("a STRUCT(...) initializer on a struct is not an array literal (0-FP)", () => {
  expect(init(`  s : S := STRUCT(a := 1);`)).toEqual([]) // aggregate_init but token is STRUCT, not '['
})

test("an unresolved declared type is skipped (0-FP)", () => {
  expect(init(`  a : Unknown_T := [1,2,3];`)).toEqual([]) // resolves to unknown → conservative skip
})

test("C0075: more values than a single-dim array holds is flagged (repeats expand)", () => {
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3,4,5,6];`)).toEqual(["Unexpected array initialisation"])
  expect(count(`  a : ARRAY[1..3] OF INT := [4(0)];`)).toEqual(["Unexpected array initialisation"]) // 4 > 3
})

test("C0075: exact, short, and nested-multidim counts stay quiet (0-FP)", () => {
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3,4,5];`)).toEqual([]) // exact
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3];`)).toEqual([]) // partial init is legal
  expect(count(`  a : ARRAY[1..3] OF INT := [3(0)];`)).toEqual([]) // repeat fills exactly
  expect(count(`  a : ARRAY[0..2] OF ARRAY[0..2] OF INT := [[1,2,3],[4,5,6],[7,8,9]];`)).toEqual([]) // 3 sub-arrays
})

test("C0232: a flat scalar where a nested array is expected", () => {
  expect(nesting(`  v : ARRAY[0..2] OF ARRAY[0..2] OF INT := [1,2,3];`)).toEqual(["Array initialisation expected"])
  expect(nesting(`  v : ARRAY[0..2] OF ARRAY[0..2] OF INT := [[1,2],[3,4],[5,6]];`)).toEqual([]) // nested — OK
  expect(nesting(`  v : ARRAY[0..1,0..2] OF INT := [1,2,3,4,5,6];`)).toEqual([]) // true multidim accepts flat
})

test("C0233: a scalar where a struct-init list is expected (enums excepted)", () => {
  expect(element(`  v : ARRAY[0..2] OF S := [1,2,3];`)).toEqual(["Initialisation list for S expected"])
  expect(element(`  v : ARRAY[0..2] OF S := [(a:=1),(a:=2),(a:=3)];`)).toEqual([]) // struct inits — OK
  expect(element(`  v : ARRAY[0..2] OF HUE := [0,1,2];`)).toEqual([]) // enum accepts integer literals — not flagged
})

test("C0162: a repeat count that is a non-constant variable is flagged (literals/constants are not)", () => {
  expect(nonConst(`  i : INT := 3; a : ARRAY[1..4] OF INT := [1,i(7)];`)).toEqual([
    "Number 'i' of array initialisation is no constant value",
  ])
  expect(nonConst(`  a : ARRAY[1..4] OF INT := [1,3(7)];`)).toEqual([]) // literal count
})

test("byte-identical on both vendors", () => {
  expect(init(`  x : INT := [1,2,3];`, "twincat")).toEqual(init(`  x : INT := [1,2,3];`, "codesys"))
})
