/**
 * wstring-escape — a WSTRING hex escape is FOUR hex digits, measured on both live IDEs 2026-09-21 by asking the
 * width instead of assuming it (`esc_wstring_*`, seventeen cells).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(src: string, vendor: Vendor = "codesys"): string[] {
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "wstring-escape")
    .map((d) => d.message)
}
const decl = (init: string) => `FUNCTION_BLOCK F\nVAR\n\tv : WSTRING := ${init};\nEND_VAR\nEND_FUNCTION_BLOCK`

test("four hex digits is the form, and everything else about it compiles", () => {
  for (const ok of ['"abc"', '"$0041"', '"$00FF"', '"$00E9"', '"$20AC"', '"a$0041b"', '"$$"', '"$N"', '"a$Tb"'])
    expect(msgs(decl(ok))).toEqual([])
  // FIVE digits is four and then a character, not an error — `$0004` followed by a literal `1`
  expect(msgs(decl('"$00041"'))).toEqual([])
})

test("too few digits ends the literal, and the initial value fails with it", () => {
  expect(msgs(decl('"$41"'))).toEqual([
    "';' expected instead of '\"$41\"'",
    "Expression expected instead of '\"$41\"'",
    "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'WSTRING'",
  ])
  // THREE digits too — the boundary is four exactly, which is why `$004` was worth asking
  expect(msgs(decl('"$004"'))[0]).toBe("';' expected instead of '\"$004\"'")
  // a SECOND `$` is not a hex digit, so `$C3` is a two-digit escape and the pair fails at the first one
  expect(msgs(decl('"$C3$A9"'))[0]).toBe("';' expected instead of '\"$C3$A9\"'")
})

// THE ECHO IS HOW FAR EACH COMPILER LEXED. CODESYS reads the whole literal and then rejects it; TwinCAT stops at
// the escape, so it quotes the opening quote through the end of the too-short hex run and no further.
test("the two vendors quote a different amount of the literal", () => {
  expect(msgs(decl('"$C3$A9"'), "twincat").slice(0, 2)).toEqual([
    "';' expected instead of '\"$C3'",
    "Expression expected instead of '\"$C3'",
  ])
  expect(msgs(decl('"$41"'), "twincat")[0]).toBe("';' expected instead of '\"$41'")
})

test("a single-quoted STRING is not this check's business — two digits is its form", () => {
  const st = (init: string) => `FUNCTION_BLOCK F\nVAR\n\tv : STRING := ${init};\nEND_VAR\nEND_FUNCTION_BLOCK`
  for (const v of ["'$41'", "'$FF'", "'$C3$A9'", "'a$41b'"]) expect(msgs(st(v))).toEqual([])
})
