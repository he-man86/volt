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

/** Every `assignment-type-mismatch` message for `x := E_Mode.Busy` with `x : <target>`, beside an enum `E_Mode`. */
const enumInto = (target: string, base = ""): string[] => {
  const src = `TYPE E_Mode :\n(\n\tIdle := 0,\n\tBusy := 1\n)${base};\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tx : ${target};\nEND_VAR\nx := E_Mode.Busy;\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an enum value converts as INT — into SINT, USINT and BYTE it does not, and the message upper-cases its name", () => {
  // `compat` widened an enum into every numeric type, so all three were silent (conformance `cc_enum_into_*`)
  expect(enumInto("SINT")).toEqual(["Cannot convert type 'E_MODE' to type 'SINT'"])
  expect(enumInto("USINT")).toEqual(["Cannot convert type 'E_MODE' to type 'USINT'"])
  expect(enumInto("BYTE")).toEqual(["Cannot convert type 'E_MODE' to type 'BYTE'"])
  for (const target of ["INT", "DINT", "LINT", "REAL", "LREAL", "UINT", "DWORD"]) expect(enumInto(target)).toEqual([])
})

test("an enum with a written base type is unmeasured, so it stays silent", () => {
  expect(enumInto("SINT", " DINT")).toEqual([])
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

test("a declaration's initial value is type-checked like an assignment, for every literal shape (gap 14)", () => {
  // Initializers were never checked; each expectation is a recording (conformance `cc_init_*`).
  expect(initMismatches("i : INT := TRUE;")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(initMismatches("i : INT := 1.5;")).toEqual(["Cannot convert type 'LREAL' to type 'INT'"])
  expect(initMismatches("t : TIME := 5;")).toEqual(["Cannot convert type 'SINT' to type 'TIME'"])
  expect(initMismatches("i : INT := 'abc';")).toEqual(["Cannot convert type 'STRING(INT#3)' to type 'INT'"])
  expect(initMismatches("si : SINT := INT#5;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(initMismatches("b : BOOL := 2;")).toEqual(["Cannot convert type 'SINT' to type 'BOOL'"])
  expect(initMismatches("re : REAL := T#1S;")).toEqual(["Cannot convert type 'TIME' to type 'REAL'"])
})

test("the initializers and assignments CODESYS accepts stay silent", () => {
  expect(initMismatches("b0 : BOOL := 0; b1 : BOOL := 1; re : REAL := 1.5; lr : LREAL := 1.5; si : SINT := 100 + 100;")).toEqual([])
  expect(mismatches("b : BOOL;", "b := 1;")).toEqual([])
})

test("a statement converts a literal the same way (conformance `cc_assign_*`)", () => {
  expect(mismatches("t : TIME;", "t := 5;")).toEqual(["Cannot convert type 'SINT' to type 'TIME'"])
  expect(mismatches("i : INT;", "i := 1.5;")).toEqual(["Cannot convert type 'LREAL' to type 'INT'"])
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

/**
 * A REFERENCE DECLARATION BINDS, and the compiler type-checks what it binds TO. This check skipped it entirely: a
 * reference is neither `checkable` nor COMPOSITE, so both shapes below passed in silence.
 *
 * The expectations are CODESYS's own, recorded 2026-09-20 (`declarations/reference-binding.ts`):
 *   `refdecl_target_wrong_type`  Cannot convert type 'STRING' to type 'REFERENCE TO INT'
 *   `refdecl_target_undeclared`  Identifier 'nope' not defined | Cannot convert type 'Unknown type: 'nope'' to …
 *
 * The VALID bind must stay silent, which is the half that matters: this check runs over 29k corpus files, and a
 * reference bound correctly is the overwhelmingly common case.
 */
test("a reference declaration type-checks its target, and a valid bind stays silent", () => {
  const decl = (init: string) => `\tv : INT;\n\ts : STRING;\n\tref_ : REFERENCE TO INT ${init};`
  expect(mismatches(decl("REF= v"), ";")).toEqual([])
  expect(mismatches(decl(":= v"), ";")).toEqual([]) // both spellings bind, and both are legal
  expect(mismatches(decl("REF= s"), ";")).toEqual(["Cannot convert type 'STRING' to type 'REFERENCE TO INT'"])
  expect(mismatches(decl("REF= nope"), ";")).toEqual([
    "Cannot convert type 'Unknown type: 'nope'' to type 'REFERENCE TO INT'",
  ])
  // a reference with NO initializer is ordinary, and must not be reported
  expect(mismatches("\tref_ : REFERENCE TO INT;", ";")).toEqual([])
})
