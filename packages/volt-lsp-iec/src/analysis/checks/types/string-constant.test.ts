/**
 * string-constant-too-long (C0198). A string literal longer than its declared STRING(n).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const sc = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM P\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "string-constant-too-long")
    .map((d) => d.message)
}

// TWINCAT HAS NO WARNING TO AGREE WITH BELOW STRING(3). The message prints a prefix of `size - 3` characters,
// and with nothing to subtract from TwinCAT's builder throws where CODESYS falls back to `size`:
// `xo4_string_constant_too_long` records `Internal error in _IStatement: one := 'ab';` and
// `Exception text: System.ArgumentOutOfRangeException: Length cannot be less than zero.`, while the isolated
// fixtures at those capacities record nothing at all (both recordings, 2026-09-20).
test("below STRING(3) the warning is CODESYS's alone — TwinCAT faults instead of printing it", () => {
  expect(sc(`  two : STRING(2) := 'abcdef';`)).toEqual(["String constant ''a...' too long for destination type 'STRING(2)'"])
  expect(sc(`  two : STRING(2) := 'abcdef';`, "twincat")).toEqual([])
  expect(sc(`  one : STRING(1) := 'ab';`, "twincat")).toEqual([])
  // …and from STRING(3) up the two agree word for word
  expect(sc(`  three : STRING(3) := 'abcdef';`, "twincat")).toEqual([
    "String constant '...' too long for destination type 'STRING(3)'",
  ])
})
/** AN ARRAY OF SIZED STRINGS IS THE SAME DESTINATION, ONCE PER ELEMENT.
 *
 * `array_initializers` recorded "String constant ''...' too long for destination type 'STRING(4)'" and the LSP
 * emitted nothing: the declaration loop asked for `decl.type.kind === "string_type"`, and an
 * `ARRAY[0..2] OF STRING(4)` is an `array_type` whose ELEMENT carries the size. Every element of every array of
 * strings in a project was unchecked. */
test("an over-length element of an ARRAY OF STRING(n) is flagged, and a fitting one is not", () => {
  expect(sc(`  texts : ARRAY[0..2] OF STRING(4) := ['a', 'bcdef'];`)).toEqual([
    "String constant ''...' too long for destination type 'STRING(4)'",
  ])
  expect(sc(`  texts : ARRAY[0..2] OF STRING(8) := ['a', 'bcdef'];`)).toEqual([])
})

test("every over-length element is reported, in source order", () => {
  // the printed prefix follows the same rule as a scalar destination (STRING(2) prints two characters of the
  // literal AS WRITTEN, so the opening quote and one letter) — it is not special-cased for arrays
  expect(sc(`  texts : ARRAY[0..2] OF STRING(2) := ['abc', 'ok', 'defg'];`)).toEqual([
    "String constant ''a...' too long for destination type 'STRING(2)'",
    "String constant ''d...' too long for destination type 'STRING(2)'",
  ])
})

test("a repeat count and a nested dimension are unwrapped to the values they hold", () => {
  // `3('abcde')` is one constant repeated — the count cannot change whether it fits, so it is reported once.
  expect(sc(`  texts : ARRAY[0..2] OF STRING(4) := [3('abcde')];`)).toEqual([
    "String constant ''...' too long for destination type 'STRING(4)'",
  ])
  // a 2-D array initialises with nested lists
  expect(sc(`  grid : ARRAY[0..1, 0..1] OF STRING(4) := [['ok', 'toolong'], ['ok', 'ok']];`)).toEqual([
    "String constant ''...' too long for destination type 'STRING(4)'",
  ])
})

test("an over-length string literal is flagged", () => {
  expect(sc(`  str : STRING(4) := '12345';`)).toEqual(["String constant ''...' too long for destination type 'STRING(4)'"])
})

test("the message prints a prefix of the literal as written, sized by the destination (consolidate-lsp-structure A10)", () => {
  // It always printed `''...'`, from the documentation catalog — right only for STRING(1) and STRING(4). Recorded for
  // lengths 1–7 (conformance `cc_string_prefix_len_*`, `cc_string_*_too_long`).
  expect(sc(`  s7 : STRING(7) := 'abcdefghij';`)).toEqual(["String constant ''abc...' too long for destination type 'STRING(7)'"])
  expect(sc(`  s3 : STRING(3) := 'ab$T$T';`)).toEqual(["String constant '...' too long for destination type 'STRING(3)'"])
  expect(sc(`  s2 : STRING(2) := '$Tabc';`)).toEqual(["String constant ''$...' too long for destination type 'STRING(2)'"])
})

test("a WSTRING is checked too — UTF-16 code units, the same printed prefix", () => {
  // Why missed: the check skipped WSTRING outright, and no fixture had an over-long one until the execution programs
  // (conformance `wstring_code_units`, `cc_wstring_init_too_long_2`, `cc_wstring_init_too_long_7`).
  expect(sc(`  w7 : WSTRING(7) := "abcdefghij";`)).toEqual([`String constant '"abc...' too long for destination type 'WSTRING(7)'`])
  expect(sc(`  w2 : WSTRING(2) := "abc";`)).toEqual([`String constant '"a...' too long for destination type 'WSTRING(2)'`])
  expect(sc(`  e3 : WSTRING(3) := "h$00E9llo"; fits : WSTRING(2) := "ü!";`)).toEqual([`String constant '...' too long for destination type 'WSTRING(3)'`])
})

test("it is a WARNING, and the length is the decoded one", () => {
  const src = `PROGRAM P\nVAR\n  s2 : STRING(2) := 'abc';\n  fits : STRING(3) := 'a$Tb';\nEND_VAR\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const found = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "string-constant-too-long")
  expect(found.map((d) => d.severity)).toEqual(["warning"]) // 'abc' into STRING(2); 'a$Tb' is 3 decoded and fits
})

test("exact/short literals and sizeless STRING stay quiet (0-FP)", () => {
  expect(sc(`  str : STRING(4) := '1234';`)).toEqual([]) // exact
  expect(sc(`  str : STRING(4) := 'ab';`)).toEqual([]) // short
  expect(sc(`  str : STRING := '12345';`)).toEqual([]) // no declared size
})

test("IEC `$` escapes count as one character (0-FP — was a corpus FP)", () => {
  expect(sc(`  str : STRING(1) := '$T';`)).toEqual([]) // $T = tab = 1 char
  expect(sc(`  str : STRING(2) := '$$$'';`)).toEqual([]) // $$ + $' = 2 chars
  expect(sc(`  str : STRING(1) := '$0D';`)).toEqual([]) // $0D = hex = 1 char
})

test("an ASSIGNMENT's target is the same destination as a declaration's", () => {
  // Why missed: the check only walked declarations, so a body store went unreported — all ten of
  // `xo4_string_constant_too_long`'s recorded warnings were missing.
  const body = (decls: string, stmts: string): string[] => {
    const src = `PROGRAM P\nVAR\n${decls}\nEND_VAR\n${stmts}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "string-constant-too-long")
      .map((d) => d.message)
  }
  expect(body(`  eight : STRING(8);`, `eight := 'seventeen';`)).toEqual([
    "String constant ''seve...' too long for destination type 'STRING(8)'",
  ])
  expect(body(`  w6 : WSTRING(6);`, `w6 := "abcdefgh";`)).toEqual([
    'String constant \'"ab...\' too long for destination type \'WSTRING(6)\'',
  ])
  // one that FITS, a sizeless STRING, and a non-literal source stay silent
  expect(body(`  fits : STRING(4); free : STRING; other : STRING(4);`, `fits := 'abcd';\nfree := 'anything at all';\nfits := other;`)).toEqual([])
  // each `:=` link is its own store: the link that takes the literal is the one that warns
  expect(body(`  a : STRING(9); b : STRING(2);`, `a := b := 'abcdefgh';`)).toEqual([
    "String constant ''a...' too long for destination type 'STRING(2)'",
  ])
})
