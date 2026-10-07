/**
 * unexpected-struct-init (C0076). A struct-literal `(field := …)` initializer on an elementary type, and the cascade
 * that follows it: the compiler resolves each FIELD NAME against the POU's own scope, where a struct's fields are not.
 * Sibling of C0074 (array literal on non-array).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const init = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE sv : STRUCT p1 : INT; p2 : INT; END_STRUCT END_TYPE`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
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
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "a.pou", parseResult: pr, source: src }], [], "codesys")
  const msgs = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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

test("a STRUCT's initializer naming a field the struct lacks: undefined, and no assignment target (D14)", () => {
  // `decl_struct_init_unknown_field`, both vendors 2026-10-01; a field it has is quiet (`decl_struct_init_missing_field`)
  const unknown = (decls: string): string[] => {
    const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE sv : STRUCT p1 : INT; p2 : INT; END_STRUCT END_TYPE`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "unknown-struct-field")
      .map((d) => d.message)
  }
  expect(unknown(`  sx : sv := (c := 1);`)).toEqual(["Identifier 'c' not defined", "'c' is no valid assignment target"])
  expect(unknown(`  sx : sv := (p1 := 1, c := 2);`)).toEqual(["Identifier 'c' not defined", "'c' is no valid assignment target"])
  expect(unknown(`  sx : sv := (p1 := 1);`)).toEqual([])
})

// A struct that EXTENDS a base the LSP cannot resolve (a library struct): the base could declare the field, so a name
// the struct's own fields lack is no fact — the guard every inherited-member lookup carries (`hasUnresolvedBase`). The
// EXTENDS stands on the TYPE: `STRUCT EXTENDS` is refused by both vendors (`unit_struct_extends_after_struct`).
test("a field of a struct whose base is unresolved is not reported unknown", () => {
  const src = `PROGRAM P\nVAR\n  rec : sv := (baseF := 1, p1 := 2);\nEND_VAR\nEND_PROGRAM\nTYPE sv EXTENDS LibBase : STRUCT p1 : INT; END_STRUCT END_TYPE`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
  const codes = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "unknown-struct-field")
  expect(codes).toEqual([])
})

// `decl_struct_init_nested_unknown_field` (both vendors 2026-10-01): a nested initializer is held to its FIELD's struct —
// the same two errors; `decl_union_init_unknown_field`: a UNION's initializer to its members, the same two.
test("a nested initializer naming a field its struct lacks, and a union's, are unknown fields", () => {
  const unknown = (decls: string): string[] => {
    const src = `PROGRAM P\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE inner : STRUCT q : INT; END_STRUCT END_TYPE\nTYPE outer : STRUCT inn : inner; k : INT; END_STRUCT END_TYPE\nTYPE uu : UNION a : INT; b : DINT; END_UNION END_TYPE`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "unknown-struct-field")
      .map((d) => d.message)
  }
  const zz = ["Identifier 'zz' not defined", "'zz' is no valid assignment target"]
  expect(unknown(`  rec : outer := (inn := (zz := 1));`)).toEqual(zz)
  expect(unknown(`  rec : outer := (k := 2, inn := (zz := 1, q := 3));`)).toEqual(zz)
  expect(unknown(`  rec : outer := (inn := (q := 1));`)).toEqual([])
  expect(unknown(`  u : uu := (zz := 1);`)).toEqual(zz)
})

// `decl_struct_init_unknown_field_in_array`, `_in_field_array` (both vendors 2026-10-01): a struct value inside an ARRAY
// initializer is held to the array's element type — at the top, and as a field's array value — the same two errors.
test("a struct value in an array initializer naming a field its element lacks is an unknown field", () => {
  const unknown = (decls: string): string[] => {
    const src = `PROGRAM P\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\nTYPE inner : STRUCT q : INT; END_STRUCT END_TYPE\nTYPE outer : STRUCT arr : ARRAY[0..1] OF inner; END_STRUCT END_TYPE`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "unknown-struct-field")
      .map((d) => d.message)
  }
  const zz = ["Identifier 'zz' not defined", "'zz' is no valid assignment target"]
  expect(unknown(`  rec : ARRAY[0..1] OF inner := [(zz := 1)];`)).toEqual(zz)
  expect(unknown(`  rec : ARRAY[0..1] OF inner := [(q := 1), (zz := 2)];`)).toEqual(zz)
  expect(unknown(`  rec : ARRAY[0..1] OF inner := [(q := 1), (q := 2)];`)).toEqual([])
  expect(unknown(`  rec : outer := (arr := [(zz := 1)]);`)).toEqual(zz)
  expect(unknown(`  rec : outer := (arr := [(q := 1)]);`)).toEqual([])
})
