/**
 * case-labels (C0216/C0217/C0218/C0219). Const-eval + constancy over CASE selector labels. C0426 (empty arm)
 * lives in the `empty-block` check — a WARNING (both vendors 2026-10-02); a comma list `1, 2:` shares a body. C0218 uses `constancyOf`, so
 * enum/VAR CONSTANT labels stay quiet (the earlier `constEval`-only attempt false-positived on those).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const cs = (arms: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src =
    `PROGRAM PLC_PRG\nVAR\n  i : INT;\n  a : INT := 2;\nEND_VAR\nVAR CONSTANT\n  K : INT := 7;\nEND_VAR\n` +
    `CASE i OF\n${arms}\nEND_CASE\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: uriFor(pr), parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
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

test("C0218: a non-constant variable label is flagged; constants/enums are not", () => {
  expect(cs(`  a: i := 1;`)).toEqual(["CASE label requires literal or symbolic integer constant"]) // `a` is a var
  expect(cs(`  K: i := 1;`)).toEqual([]) // VAR CONSTANT symbolic label — valid
  expect(cs(`  1: i := 1;\n  2..4: i := 2;\n  K: i := 3;\n  5,6: i := 4;`)).toEqual([]) // well-formed
})

test("an empty CASE arm is no error — a warning, `empty-block`'s (C0426; stmt_case_empty_arm, both vendors 2026-10-02); comma shares a body", () => {
  expect(cs(`  1:\n  2: i := 1;`)).toEqual([]) // separate empty label → a warning, not an error
  expect(cs(`  1, 2: i := 1;`)).toEqual([]) // comma-shared body → legal
})

test("C0218: enum-member labels stay quiet (the 207-FP case)", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n  stv : (A, B, C);\n  n : INT;\nEND_VAR\nCASE stv OF\n  A: n:=1;\n  B: n:=2;\n  C: n:=3;\nEND_CASE\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(pr), parseResult: pr, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "case-label-non-const")
    .map((d) => d.message)
  expect(msgs).toEqual([])
})

test("CASE-label wording is per-vendor (verified live): CODESYS 'CASE', TwinCAT 'Case'", () => {
  expect(cs(`  1: i := 1;\n  1: i := 2;`, "codesys")).toEqual(["CASE label duplicate"])
  expect(cs(`  1: i := 1;\n  1: i := 2;`, "twincat")).toEqual(["Case label duplicate"])
})

// transpile-review 37 (`tr_37_case_*`, recorded 2026-09-29): a label outside the selector's type does not wrap into it — it is
// refused as a conversion — and a range that is inverted, or inverted once its upper bound wraps into the type, is refused
// with its own message. Each was silent.
const sint = (arms: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  sv : SINT;\n  res : INT;\nEND_VAR\nCASE sv OF\n${arms}\nELSE res := 2;\nEND_CASE\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(pr), parseResult: pr, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
}

test("a CASE label outside the selector's type is refused; an inverted range is refused", () => {
  expect(sint(`  300: res := 1;`)).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(sint(`  -212: res := 1;`)).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  expect(sint(`  5..1: res := 1;`)).toEqual(["Lower border must be lower than upper border"])
  expect(sint(`  0..200: res := 1;`)).toEqual(["Lower border must be lower than upper border"])
  expect(cs(`  5..1: i := 1;`)).toEqual(["Lower border must be lower than upper border"])
  // in the type, and a well-formed range: silent
  expect(sint(`  -128: res := 1;\n  127: res := 3;\n  1..100: res := 4;`)).toEqual([])
})

// A TYPED LITERAL AS A LABEL (frontend-conformance 2.2b, CODESYS 2026-10-01): `INT#5:` is a label like `5:`
// (`lit_typed_int_case_label` builds and runs), and an enum's `Type#Value` — a value of no type to CODESYS — is not a
// constant: "CASE label requires literal or symbolic integer constant" (`lit_enum_typed_case_label`).
test("a typed integer label is a label; an enum `Type#Value` label is no constant", () => {
  expect(cs(`  INT#5: i := 1;`)).toEqual([])
  const src =
    `PROGRAM PLC_PRG\nVAR\n  m : E_Mode;\n  i : INT;\nEND_VAR\nCASE m OF\nE_Mode#Running: i := 1;\nEND_CASE\nEND_PROGRAM`
  const enumSrc = "TYPE E_Mode :\n(\n\tIdle,\n\tRunning\n);\nEND_TYPE\n"
  const pr = parseSource(src, { networkText: true })
  const er = parseSource(enumSrc, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(pr), parseResult: pr, source: src }, { uri: "file:///E_Mode.dut", parseResult: er, source: enumSrc }], [], "codesys")
  const errs = [...pr.errors.map((e) => e.message), ...computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error").map((d) => d.message)]
  expect(errs).toEqual(["CASE label requires literal or symbolic integer constant"])
})

test("a typed-literal label of a type the selector does not take does not convert; a narrower one does (stmt_case_typed_label_other_type, _narrower, stmt_case_typed_label, ST9)", () => {
  // both vendors 2026-10-02: `DINT#2:` on an INT selector; `INT#1:`/`INT#2:` on an INT and on a DINT build
  expect(cs(`  INT#1: i := 1;\n  DINT#2: i := 2;`)).toEqual(["Cannot convert type 'DINT' to type 'INT'"])
  expect(cs(`  INT#1: i := 1;\n  INT#2: i := 2;`)).toEqual([])
})

test("TwinCAT ends the inverted-range message with a full stop, as it does for an array's (stmt_case_reversed_range, ST7)", () => {
  expect(cs(`  3..1: i := 1;`)).toEqual(["Lower border must be lower than upper border"])
  expect(cs(`  3..1: i := 1;`, "twincat")).toEqual(["Lower border must be lower than upper border."])
})

// Rule EN3 (frontend-conformance 3.3, `enum_same_member_case_label`, both vendors 2026-10-02): a label that is a member two
// enums declare names nothing — "Ambiguous use of name", "Identifier not defined", and as a label no constant either
test("C0218: a label two enums declare is no constant", () => {
  const src = "TYPE E_A : (en_x := 3);\nEND_TYPE\nTYPE E_B : (en_x := 5, en_z := 6);\nEND_TYPE\n" +
    "PROGRAM PLC_PRG\nVAR\n  e : E_B;\nEND_VAR\nCASE e OF\n  en_x: e := E_B.en_z;\n  en_z: ;\nEND_CASE\nEND_PROGRAM"
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(pr), parseResult: pr, source: src }])
  const said = computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
  expect(said.filter((m) => m.startsWith("CASE label"))).toEqual(["CASE label requires literal or symbolic integer constant"])
})
