/**
 * jump-labels — JMP/label analysis (C0114/C0116/C0117/C0118). Each malformed jump yields exactly one code;
 * a well-formed JMP↔label pair stays silent (zero-FP contract). Wording is provisional (no live recording yet).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const codes = (body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR i : INT;\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "PLC_PRG.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.code)
}

test("C0114 — JMP to a non-label destination", () => {
  expect(codes("JMP 0;")).toEqual(["jump-invalid-destination"])
})

test("C0116 — a duplicate label", () => {
  expect(codes("JMP a;\na:\na:")).toEqual(["jump-label-duplicate"])
})

test("C0117 — JMP to an undefined label", () => {
  expect(codes("JMP nowhere;")).toEqual(["jump-label-undefined"])
})

test("C0118 — a label no JMP targets", () => {
  expect(codes("unused:")).toEqual(["jump-label-unreferenced"])
})

test("a well-formed JMP↔label pair is silent (zero-FP)", () => {
  expect(codes("top:\ni := i + 1;\nJMP top;")).toEqual([])
})

test("case-insensitive matching — JMP LBL reaches label lbl", () => {
  expect(codes("lbl:\ni := 1;\nJMP LBL;")).toEqual([])
})
