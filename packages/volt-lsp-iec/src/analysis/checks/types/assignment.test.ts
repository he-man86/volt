/**
 * assignment-type-mismatch — the duration literals (gap 8). The AST gives `T#` and `LTIME#` one literalKind, and inference
 * typed both TIME. Expectations are CODESYS's recorded answers (conformance `cc_ltime_literal_into_time`,
 * `cc_fp_ltime_literal_into_ltime`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const mismatches = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an LTIME literal into a TIME does not convert — it was silent", () => {
  expect(mismatches("t1 : TIME;", "t1 := LTIME#1S;")).toEqual(["Cannot convert type 'LTIME' to type 'TIME'"])
})

/** Every `assignment-type-mismatch` message for a declaration-only FB. */
const initMismatches = (vars: string): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an untyped integer literal too wide for its target is an error, as its literal type (gap 13)", () => {
  // It was silent: inference types a bare integer literal UNKNOWN, and nothing checked an initializer at all.
  expect(mismatches("si : SINT;", "si := 300;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(mismatches("si : SINT;", "si := -129;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(mismatches("us : USINT;", "us := 256;")).toEqual(["Cannot convert type 'INT' to type 'USINT'"])
  expect(mismatches("u : UINT;", "u := 70000;")).toEqual(["Cannot convert type 'DINT' to type 'UINT'"])
  expect(initMismatches("b : BYTE := 300;")).toEqual(["Cannot convert type 'INT' to type 'BYTE'"])
  expect(initMismatches("w : WORD := 70000;")).toEqual(["Cannot convert type 'DINT' to type 'WORD'"])
})

test("a literal the target holds, or one only a sign warning away, is no error", () => {
  expect(mismatches("b : BYTE; si : SINT; us : USINT; i : INT;", "b := 255; si := 127; us := 5; i := 200; si := 128; us := -1;")).toEqual([])
  expect(initMismatches("i : INT := 40000; u : UINT := -5;")).toEqual([])
})

test("an L-prefixed date literal is the 64-bit type, printed as CODESYS prints it (consolidate-lsp-structure A2)", () => {
  // Inference typed every date literal without its `L`, so these were silent while lowering typed them right.
  expect(mismatches("d1 : DATE;", "d1 := LDATE#2024-02-28;")).toEqual(["Cannot convert type 'LDATE' to type 'DATE'"])
  expect(mismatches("t1 : TOD;", "t1 := LTOD#12:30:15;")).toEqual(["Cannot convert type 'LTIME_OF_DAY' to type 'TIME_OF_DAY'"])
  expect(mismatches("dt1 : DT;", "dt1 := LDT#2024-02-28-12:30:15;")).toEqual(["Cannot convert type 'LDATE_AND_TIME' to type 'DATE_AND_TIME'"])
  expect(mismatches("ld1 : LDATE; lt1 : LTOD; d1 : DATE;", "ld1 := LDATE#2024-02-28; lt1 := LTOD#12:30:15; d1 := D#2024-02-28;")).toEqual([])
})

test("an LTIME literal into an LTIME is clean — typed TIME, it was a false positive", () => {
  expect(mismatches("lt1 : LTIME;", "lt1 := LTIME#1S;")).toEqual([])
  expect(mismatches("t1 : TIME;", "t1 := T#1S;")).toEqual([])
})
