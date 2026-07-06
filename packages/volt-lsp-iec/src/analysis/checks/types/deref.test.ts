/**
 * deref-non-pointer — targeted cases. `x^` on a non-pointer errors; every derefable-or-undecidable base
 * (pointer/reference/THIS/unresolved) stays quiet (zero-FP is the whole game — see the check header).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type DiagnosticItem, type Vendor } from "../../index.js"

function diag(src: string, vendor: Vendor): DiagnosticItem[] {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
}

/** deref-non-pointer messages only. */
const deref = (src: string, v: Vendor = "codesys"): string[] =>
  diag(src, v)
    .filter((d) => d.code === "deref-non-pointer")
    .map((d) => d.message)

const fb = (body: string) => `FUNCTION_BLOCK F\n${body}\nEND_FUNCTION_BLOCK`

test("dereferencing a scalar is flagged, byte-identical per vendor", () => {
  const src = fb(`VAR i : INT; END_VAR\ni := i^;`)
  expect(deref(src, "codesys")).toEqual(["Dereference requires a pointer"])
  expect(deref(src, "twincat")).toEqual(["Dereference requires Pointer"])
})

test("dereferencing an array is flagged", () => {
  expect(deref(fb(`VAR a : ARRAY[0..3] OF INT; i : INT; END_VAR\ni := a^;`))).toHaveLength(1)
})

test("dereferencing a POINTER is not flagged (the legal case)", () => {
  expect(deref(fb(`VAR p : POINTER TO INT; i : INT; END_VAR\ni := p^;`))).toEqual([])
})

test("dereferencing a REFERENCE is not flagged", () => {
  expect(deref(fb(`VAR r : REFERENCE TO INT; i : INT; END_VAR\ni := r^;`))).toEqual([])
})

test("THIS^ is not flagged (deref folds to the FB itself)", () => {
  expect(deref(fb(`VAR i : INT; END_VAR\nTHIS^.i := 1;`))).toEqual([])
})

test("an unresolved base is not flagged (undecidable → skip)", () => {
  expect(deref(fb(`VAR i : INT; END_VAR\ni := nope^;`))).toEqual([])
})
