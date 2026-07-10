/**
 * case-labels (C0216/C0217/C0218/C0219). Const-eval + constancy over CASE selector labels. Docs wording;
 * provisional until a live recording locks it. C0426 (empty arm) is deliberately NOT here — CODESYS accepts
 * fall-through empty arms. C0218 uses `constancyOf`, so enum/VAR CONSTANT labels stay quiet (the earlier
 * `constEval`-only attempt false-positived on those).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const cs = (arms: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src =
    `PROGRAM PLC_PRG\nVAR\n  i : INT;\n  a : INT := 2;\nEND_VAR\nVAR CONSTANT\n  K : INT := 7;\nEND_VAR\n` +
    `CASE i OF\n${arms}\nEND_CASE\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
}

test("C0216 duplicate single label", () => {
  expect(cs(`  1: i := 1;\n  1: i := 2;`)).toEqual(["CASE label duplicate"])
})

test("C0217 single label inside a range", () => {
  expect(cs(`  3..5: i := 1;\n  4: i := 2;`)).toEqual(["CASE label 4 also contained in range 3 .. 5"])
})

test("C0219 overlapping ranges, rendered lowest-first", () => {
  expect(cs(`  3..5: i := 1;\n  1..4: i := 2;`)).toEqual(["CASE contains overlapping range 1 .. 4 and 3 .. 5"])
})

test("C0218: a non-constant variable label is flagged; constants/enums/empty-arms are not", () => {
  expect(cs(`  a: i := 1;`)).toEqual(["CASE label requires literal or symbolic integer constant"]) // `a` is a var
  expect(cs(`  K: i := 1;`)).toEqual([]) // VAR CONSTANT symbolic label — valid
  expect(cs(`  1:\n  2: i := 1;`)).toEqual([]) // empty fall-through arm (C0426, won't-fix)
  expect(cs(`  1: i := 1;\n  2..4: i := 2;\n  K: i := 3;\n  5,6: i := 4;`)).toEqual([]) // well-formed
})

test("C0218: enum-member labels stay quiet (the 207-FP case)", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n  st : (A, B, C);\n  n : INT;\nEND_VAR\nCASE st OF\n  A: n:=1;\n  B: n:=2;\n  C: n:=3;\nEND_CASE\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "case-label-non-const")
    .map((d) => d.message)
  expect(msgs).toEqual([])
})

test("byte-identical on both vendors", () => {
  expect(cs(`  1: i := 1;\n  1: i := 2;`, "twincat")).toEqual(cs(`  1: i := 1;\n  1: i := 2;`, "codesys"))
})
