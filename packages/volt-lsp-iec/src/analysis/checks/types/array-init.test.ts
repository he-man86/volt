/**
 * array-initializer checks: C0074 unexpected-array-init (array literal on a non-array type) and C0075
 * array-init-count (too many values for a single-dim array).
 * The declared type is resolved, so array aliases stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const byCode =
  (code: string) =>
  (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
    const src =
      `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\n` +
      `TYPE MyArr : ARRAY[0..2] OF INT; END_TYPE\nTYPE sv : STRUCT a : INT; END_STRUCT END_TYPE\n` +
      `TYPE HUE : (RED, GREEN, BLUE); END_TYPE`
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
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
  expect(init(`  sv : sv := STRUCT(a := 1);`)).toEqual([]) // aggregate_init but token is STRUCT, not '['
})

test("an unresolved declared type is skipped (0-FP)", () => {
  expect(init(`  a : Unknown_T := [1,2,3];`)).toEqual([]) // resolves to unknown → conservative skip
})

test("C0075: more values than a single-dim array holds is flagged (repeats expand)", () => {
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3,4,5,6];`)).toEqual(["Too many initializers for array"])
  expect(count(`  a : ARRAY[1..3] OF INT := [4(0)];`)).toEqual(["Too many initializers for array"]) // 4 > 3
})

test("C0075: exact, short, and nested-multidim counts stay quiet (0-FP)", () => {
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3,4,5];`)).toEqual([]) // exact
  expect(count(`  a : ARRAY[1..5] OF INT := [1,2,3];`)).toEqual([]) // partial init is legal
  expect(count(`  a : ARRAY[1..3] OF INT := [3(0)];`)).toEqual([]) // repeat fills exactly
  expect(count(`  a : ARRAY[0..2] OF ARRAY[0..2] OF INT := [[1,2,3],[4,5,6],[7,8,9]];`)).toEqual([]) // 3 sub-arrays
})

test("C0232: a flat scalar where a nested array is expected", () => {
  // one per scalar, as both vendors say it (`arrinit_flat_into_nested`; the first cut said it once)
  expect(nesting(`  v : ARRAY[0..2] OF ARRAY[0..2] OF INT := [1,2,3];`)).toEqual(Array(3).fill("Array initialisation expected"))
  expect(nesting(`  v : ARRAY[0..2] OF ARRAY[0..2] OF INT := [[1,2],[3,4],[5,6]];`)).toEqual([]) // nested — OK
  expect(nesting(`  v : ARRAY[0..1,0..2] OF INT := [1,2,3,4,5,6];`)).toEqual([]) // true multidim accepts flat
})

test("C0233: a scalar where a struct-init list is expected (enums excepted)", () => {
  expect(element(`  v : ARRAY[0..2] OF sv := [1,2,3];`)).toEqual(Array(3).fill("Initialisation list for sv expected")) // one per scalar
  expect(element(`  v : ARRAY[0..2] OF sv := [(a:=1),(a:=2),(a:=3)];`)).toEqual([]) // struct inits — OK
  expect(element(`  v : ARRAY[0..2] OF HUE := [0,1,2];`)).toEqual([]) // enum accepts integer literals — not flagged
})

test("C0162: a repeat count that is a non-constant variable is flagged (literals/constants are not)", () => {
  expect(nonConst(`  i : INT := 3; a : ARRAY[1..4] OF INT := [1,i(7)];`)).toEqual([
    "Number 'i' of array initialisations is no constant value",
  ])
  expect(nonConst(`  a : ARRAY[1..4] OF INT := [1,3(7)];`)).toEqual([]) // literal count
})

test("byte-identical on both vendors", () => {
  expect(init(`  x : INT := [1,2,3];`, "twincat")).toEqual(init(`  x : INT := [1,2,3];`, "codesys"))
})

test("a MULTI-dimensional array is initialized flat: a nested list there is an unexpected array initialisation (D15)", () => {
  // TwinCAT `decl_nested_aggregate` (CODESYS SP21 throws on it); flat and ARRAY OF ARRAY build (`_flat`, `_array_of_array`)
  expect(init(`  a : ARRAY[0..1, 0..1] OF INT := [[1, 2], [3, 4]];`, "twincat")).toEqual(["Unexpected array initialisation"])
  expect(init(`  a : ARRAY[0..1, 0..1] OF INT := [1, 2, 3, 4];`)).toEqual([])
  expect(init(`  a : ARRAY[0..1] OF ARRAY[0..1] OF INT := [[1, 2], [3, 4]];`)).toEqual([])
})

/** Every error the declarations `decls` give (besides the program's own). */
const errors = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src =
    `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\n` +
    `TYPE MyArr : ARRAY[0..2] OF INT; END_TYPE\nTYPE sv : STRUCT a : INT; END_STRUCT END_TYPE\n`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error" && d.code !== "signature-name-mismatch")
    .map((d) => d.message)
}

test("a flat list on an ARRAY OF ARRAY: every scalar is 'Array initialisation expected' and its conversion, and the count is checked too (arrinit_flat_into_nested)", () => {
  expect(errors("  a : ARRAY[0..1] OF ARRAY[0..1] OF INT := [1, 2, 3, 4];").sort()).toEqual(
    [
      "Too many initializers for array",
      ...["BIT", "SINT", "SINT", "SINT"].flatMap((t) => ["Array initialisation expected", `Cannot convert type '${t}' to type 'ARRAY [0..1] OF INT'`]),
    ].sort(),
  )
})

test("scalars on an ARRAY OF a struct: every scalar is 'Initialisation list … expected' and its conversion (arrinit_scalar_into_struct_array)", () => {
  expect(errors("  a : ARRAY[0..1] OF sv := [1, 2];").sort()).toEqual(
    ["Initialisation list for sv expected", "Cannot convert type 'BIT' to type 'sv'", "Initialisation list for sv expected", "Cannot convert type 'SINT' to type 'sv'"].sort(),
  )
})

test("an array literal on a scalar or a struct is also the conversion of the literal the compiler cannot type (arrinit_on_scalar, arrinit_on_struct)", () => {
  expect(errors("  n : INT := [1, 2];")).toEqual(["Unexpected array initialisation", "Cannot convert type 'Unknown type: '[1, 2]'' to type 'INT'"])
  expect(errors("  s1 : sv := [1, 2];")).toEqual(["Unexpected array initialisation", "Cannot convert type 'Unknown type: '[1, 2]'' to type 'sv'"])
})

test("too many values on a MULTI-dimensional array is counted over every dimension (arrinit_too_many_two_dims)", () => {
  expect(count("  a : ARRAY[0..1, 0..1] OF INT := [1, 2, 3, 4, 5];")).toEqual(["Too many initializers for array"])
  expect(count("  a : ARRAY[0..1, 0..1] OF INT := [1, 2, 3, 4];")).toEqual([])
})
