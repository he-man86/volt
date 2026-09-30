/**
 * header-rules — C0096 (multiple EXTENDS bases on an FB), C0182 (return type on a PROGRAM), C0421 (an
 * INTERFACE using IMPLEMENTS). Each fires only in the illegal
 * case; the legal forms stay silent.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string, code: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === code)
    .map((d) => d.message)
}

test("C0096: an FB with more than one EXTENDS base is flagged; a single base is fine", () => {
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB2, FB3\nEND_FUNCTION_BLOCK`, "multiple-inheritance")).toEqual([
    "Only one base function block may be defined in EXTENDS list",
  ])
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB2\nEND_FUNCTION_BLOCK`, "multiple-inheritance")).toEqual([])
})

test("C0182: a return type on a PROGRAM is flagged; a bare PROGRAM is fine", () => {
  expect(msgs(`PROGRAM P : BOOL\nEND_PROGRAM`, "return-type-not-allowed")).toEqual([
    "Return type is only possible for POUs of type FUNCTION and METHOD",
  ])
  expect(msgs(`PROGRAM P\nEND_PROGRAM`, "return-type-not-allowed")).toEqual([])
})

test("C0421: an INTERFACE using IMPLEMENTS is flagged; EXTENDS is fine", () => {
  expect(msgs(`INTERFACE ITF_1 IMPLEMENTS ITF\nEND_INTERFACE`, "interface-implements")).toEqual([
    "Use keyword EXTENDS for inheritance of interfaces instead of IMPLEMENTS",
  ])
  expect(msgs(`INTERFACE ITF_1 EXTENDS ITF\nEND_INTERFACE`, "interface-implements")).toEqual([])
})

test("C0149: a VAR section inside an INTERFACE is flagged; a method-only interface is fine", () => {
  // Deleted on 2026-09-16 because `cc2_var_in_interface` builds clean, RESTORED on 2026-09-17 because that
  // fixture proves nothing: its interface is implemented by nobody, so CODESYS never looks inside it. Add an
  // implementer (`itf_var_section_inherited`) and the compiler says exactly this. The lesson is reachability,
  // not wording — a clean build on an unreferenced POU is not evidence that a rule is wrong.
  expect(msgs(`INTERFACE ITF\nVAR_INPUT\n  i : INT;\nEND_VAR\nEND_INTERFACE`, "var-in-interface")).toEqual([
    "Variable declarations are not allowed in interfaces",
  ])
  expect(msgs(`INTERFACE ITF\nMETHOD M : BOOL\nEND_METHOD\nEND_INTERFACE`, "var-in-interface")).toEqual([])
})

test("C0144: EXTENDS on an enum/alias DUT is flagged; a struct EXTENDS is fine", () => {
  expect(msgs(`TYPE E EXTENDS Base :\n(\n  A, B\n); END_TYPE`, "inheritance-not-allowed")).toEqual([
    "Inheritance only allowed in function blocks, Interfaces and Structures",
  ])
  expect(msgs(`TYPE A EXTENDS Base : INT; END_TYPE`, "inheritance-not-allowed")).toEqual([
    "Inheritance only allowed in function blocks, Interfaces and Structures",
  ])
  // A struct legitimately EXTENDS another struct — never flagged.
  expect(msgs(`TYPE S EXTENDS Base :\nSTRUCT\n  x : INT;\nEND_STRUCT\nEND_TYPE`, "inheritance-not-allowed")).toEqual([])
})

test("C0542: EXTENDS on a UNION is flagged with its type name", () => {
  expect(msgs(`TYPE U EXTENDS Base :\nUNION\n  a : INT;\nEND_UNION\nEND_TYPE`, "union-inheritance")).toEqual([
    `Inheritance is not intended for data type "UNION": Base`,
  ])
  expect(msgs(`TYPE U :\nUNION\n  a : INT;\nEND_UNION\nEND_TYPE`, "union-inheritance")).toEqual([])
})

test("C0145: IMPLEMENTS on a FUNCTION is flagged; a bare FUNCTION is fine", () => {
  expect(msgs(`FUNCTION F IMPLEMENTS ITF\nVAR\nEND_VAR\nEND_FUNCTION`, "function-implements")).toEqual([
    "Interfaces can only be implemented by function blocks",
  ])
  expect(msgs(`FUNCTION F : INT\nVAR\nEND_VAR\nEND_FUNCTION`, "function-implements")).toEqual([])
})

/** Every error the analysis gives `own`, in a project of `own` and `others` — whole, not filtered by code. */
const allErrors = (own: { uri: string; source: string }, others: { uri: string; source: string }[]): string[] => {
  const files = [own, ...others].map((f) => ({ ...f, parseResult: parseSource(f.source) }))
  const project = buildSymbolTable(files)
  return computeSemanticDiagnostics({ parseResult: files[0]!.parseResult, source: own.source, project, config: resolveConfig({ vendor: "codesys" }), uri: own.uri })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
}

// `hdr_function_extends_no_return` (CODESYS SP21, 2026-09-30 — push-without-header-check 4.3): a FUNCTION reads an
// EXTENDS clause and answers that the base does not exist, although `FB_LANG_oop_base` does — as a function block. A
// function has no base CLASS, so none is ever found. Nothing else is reported, the call included.
test("a FUNCTION that EXTENDS: its base class is never found, even one that exists", () => {
  const base = { uri: "FB_Base.fb", source: "FUNCTION_BLOCK FB_Base\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n" }
  const f = { uri: "F_Ext.fun", source: "FUNCTION F_Ext EXTENDS FB_Base\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n" }
  expect(allErrors(f, [base])).toEqual(["No definition found for base class 'FB_Base'"])
})

// `hdr_function_implements_no_return` on TwinCAT (2026-09-30): the same rule in TwinCAT's own spelling — the catalog's
// `twincatActual` for C0145 had it since 2026-07-11, and it is the one word that differs.
test("C0145 on TwinCAT: 'Functionblocks', as TwinCAT writes it", () => {
  const src = "FUNCTION F_Impl IMPLEMENTS ITF_A\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n"
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F_Impl.fun", parseResult, source: src }], [], "twincat")
  const got = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) })
    .filter((d) => d.code === "function-implements")
    .map((d) => d.message)
  expect(got).toEqual(["Interfaces can only be implemented by Functionblocks"])
})

// `hdr_function_implements` / `hdr_function_extends` (both vendors, 2026-09-30): a return type AFTER the clause. Both
// vendors read the clause where they read an FB's — straight after the name — and then cascade from the `:`; the LSP
// reads the clause at the same place and the return type after it, so it gives the clause's own message and NOTHING the
// vendors do not (the cascade is theirs alone — a known divergence). It read IMPLEMENTS only after the return type,
// left `: INT` unread, and the rest of the file became body: two "IMPLEMENTATION line inside a body" errors, a parse
// error on the `:`, and "requires exactly '0' inputs" at every call — none of them any vendor's.
test("a clause before the return type is read whole: only the clause's own message, on the unit and at the call", () => {
  const itf = { uri: "ITF_A.itf", source: "INTERFACE ITF_A\nEND_INTERFACE\n" }
  const base = { uri: "FB_Base.fb", source: "FUNCTION_BLOCK FB_Base\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" }
  const caller = (f: string) => ({
    uri: "PLC_PRG.prg",
    source: `PROGRAM PLC_PRG\nVAR\n\tnOut : INT;\nEND_VAR\nIMPLEMENTATION ST\nnOut := ${f}(2);\nEND_PROGRAM\n`,
  })
  const impl = { uri: "F_Impl.fun", source: "FUNCTION F_Impl IMPLEMENTS ITF_A : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF_Impl := x;\nEND_FUNCTION\n" }
  const ext = { uri: "F_Ext.fun", source: "FUNCTION F_Ext EXTENDS FB_Base : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF_Ext := x;\nEND_FUNCTION\n" }
  expect(parseSource(impl.source).errors.map((e) => e.message)).toEqual([])
  expect(allErrors(impl, [itf, caller("F_Impl")])).toEqual(["Interfaces can only be implemented by function blocks"])
  expect(allErrors(caller("F_Impl"), [impl, itf])).toEqual([])
  expect(allErrors(ext, [base, caller("F_Ext")])).toEqual(["No definition found for base class 'FB_Base'"])
  expect(allErrors(caller("F_Ext"), [ext, base])).toEqual([])
})
