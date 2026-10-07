/**
 * header-rules — C0096 (multiple EXTENDS bases on an FB), C0182 (return type on a PROGRAM), C0421 (an
 * INTERFACE using IMPLEMENTS). Each fires only in the illegal
 * case; the legal forms stay silent.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../test-uri.js"

const msgs = (src: string, code: string): string[] => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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

const all = (src: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  // every message but the object-name one: the sources here are not named after a file
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code !== "signature-name-mismatch")
    .map((d) => d.message)
}

// The measured rule (`fixtures/grammar/units.ts`, both vendors 2026-10-01) replaced "C0144 on any enum or alias", whose
// wording no recording held ("function blocks, Interfaces and Structures"): an ALIAS gets two messages, the first naming
// the base on CODESYS and the type on TwinCAT; an ENUM gets the inheritance message only when its base IS an enum — any
// other base is one it does not find.
test("C0144: EXTENDS on an alias — 'not applicable' and 'only allowed', each vendor's words", () => {
  const src = "TYPE S :\nSTRUCT\n  x : INT;\nEND_STRUCT\nEND_TYPE\n\nTYPE A EXTENDS S : INT;\nEND_TYPE\n"
  expect(all(src)).toEqual([
    "Keyword EXTENDS not applicable to type S",
    "Inheritance only allowed in function blocks, interfaces and structures",
  ])
  expect(all(src, "twincat")).toEqual([
    "Keyword EXTENDS not applicable to type A",
    "Inheritance only allowed in Functionblocks, Interfaces and Structures",
  ])
})

test("C0144: EXTENDS on an enum — an enum base is 'only allowed', any other base is not found", () => {
  const enumBase = "TYPE E1 :\n(\n  A, B\n);\nEND_TYPE\n\nTYPE E2 EXTENDS E1 :\n(\n  C, D\n);\nEND_TYPE\n"
  expect(all(enumBase)).toEqual(["Inheritance only allowed in function blocks, interfaces and structures"])
  const struct = "TYPE S :\nSTRUCT\n  x : INT;\nEND_STRUCT\nEND_TYPE\n\n"
  expect(all(struct + "TYPE E EXTENDS S :\n(\n  C, D\n);\nEND_TYPE\n")).toEqual(["No definition found for base class 'S'"])
  // A struct legitimately EXTENDS another struct — never flagged.
  expect(all(struct + "TYPE S2 EXTENDS S :\nSTRUCT\n  y : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual([])
})

test("PRIVATE or PROTECTED on a FUNCTION_BLOCK, or on an interface member", () => {
  expect(all("FUNCTION_BLOCK PRIVATE FB\nEND_FUNCTION_BLOCK\n")).toEqual([
    "PRIVATE and PROTECTED may only be applied on methods of function blocks",
  ])
  expect(all("FUNCTION_BLOCK PROTECTED FB\nEND_FUNCTION_BLOCK\n", "twincat")).toEqual([
    "PRIVATE and PROTECTED may only be applied on methods of functionblocks",
  ])
  expect(all("INTERFACE I\nMETHOD PROTECTED M : INT\nEND_METHOD\nEND_INTERFACE\n")).toEqual([
    "PRIVATE and PROTECTED may only be applied on methods of function blocks",
  ])
  // an interface PROPERTY's is CODESYS's alone (unit_interface_property_private builds on TwinCAT)
  const prop = "INTERFACE I\nPROPERTY PRIVATE P : INT\nGET\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n"
  expect(all(prop)).toEqual(["PRIVATE and PROTECTED may only be applied on methods of function blocks"])
  expect(all(prop, "twincat")).toEqual([])
  // on a METHOD of a function block, and PUBLIC/INTERNAL anywhere, it is legal
  expect(all("FUNCTION_BLOCK INTERNAL FB\nEND_FUNCTION_BLOCK\n\nMETHOD PRIVATE M : INT\nM := 1;\nEND_METHOD\n")).toEqual([])
})

test("ABSTRACT and FINAL on one FUNCTION_BLOCK or METHOD", () => {
  expect(all("FUNCTION_BLOCK ABSTRACT FINAL FB\nEND_FUNCTION_BLOCK\n")).toEqual([
    "A method or functionblock cannot be ABSTRACT and FINAL",
  ])
  expect(all("FUNCTION_BLOCK ABSTRACT FB\nEND_FUNCTION_BLOCK\n\nMETHOD ABSTRACT FINAL M : INT\nEND_METHOD\n", "twincat")).toEqual([
    "A method or functionblock cannot be ABSTRACT and FINAL",
  ])
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
  const files = [own, ...others].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) }))
  const project = build.buildSymbolTable(files)
  return computeDiagnostics({ parseResult: files[0]!.parseResult, source: own.source, project, config: resolveConfig({ vendor: "codesys" }), uri: own.uri })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
}

// `hdr_function_extends_no_return` (CODESYS SP21, 2026-09-30 — push-without-header-check 4.3): a FUNCTION reads an
// EXTENDS clause and answers that the base does not exist, although `FB_LANG_oop_base` does — as a function block. A
// function has no base CLASS, so none is ever found. Nothing else is reported, the call included.
test("a FUNCTION that EXTENDS: its base class is never found, even one that exists", () => {
  const base = { uri: "FB_Base.pou", source: "FUNCTION_BLOCK FB_Base\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n" }
  const f = { uri: "F_Ext.pou", source: "FUNCTION F_Ext EXTENDS FB_Base\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n" }
  expect(allErrors(f, [base])).toEqual(["No definition found for base class 'FB_Base'"])
})

// `hdr_function_implements_no_return` on TwinCAT (2026-09-30): the same rule in TwinCAT's own spelling — the catalog's
// `twincatActual` for C0145 had it since 2026-07-11, and it is the one word that differs.
test("C0145 on TwinCAT: 'Functionblocks', as TwinCAT writes it", () => {
  const src = "FUNCTION F_Impl IMPLEMENTS ITF_A\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n"
  const parseResult = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "F_Impl.pou", parseResult, source: src }], [], "twincat")
  const got = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) })
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
  const base = { uri: "FB_Base.pou", source: "FUNCTION_BLOCK FB_Base\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" }
  const caller = (f: string) => ({
    uri: "PLC_PRG.pou",
    source: `PROGRAM PLC_PRG\nVAR\n\tnOut : INT;\nEND_VAR\nIMPLEMENTATION ST\nnOut := ${f}(2);\nEND_PROGRAM\n`,
  })
  const impl = { uri: "F_Impl.pou", source: "FUNCTION F_Impl IMPLEMENTS ITF_A : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF_Impl := x;\nEND_FUNCTION\n" }
  const ext = { uri: "F_Ext.pou", source: "FUNCTION F_Ext EXTENDS FB_Base : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF_Ext := x;\nEND_FUNCTION\n" }
  expect(parseSource(impl.source, { networkText: true }).errors.map((e) => e.message)).toEqual([])
  expect(allErrors(impl, [itf, caller("F_Impl")])).toEqual(["Interfaces can only be implemented by function blocks"])
  expect(allErrors(caller("F_Impl"), [impl, itf])).toEqual([])
  expect(allErrors(ext, [base, caller("F_Ext")])).toEqual(["No definition found for base class 'FB_Base'"])
  expect(allErrors(caller("F_Ext"), [ext, base])).toEqual([])
})

// U21 (`unit_interface_property_accessor_var`, `_var_input`; record:exec, CODESYS 2026-10-01 — the push refuses to write
// an interface accessor's declaration, so the IDE was asked through the simulator's own object load): a variable an
// interface accessor DECLARES is refused, a bare `VAR END_VAR` (263 of them in pro2193) is not. TwinCAT is unmeasured.
test("a variable declared in an interface accessor: a VAR's is refused, a VAR_INPUT's echoes the declaration (CODESYS)", () => {
  const itf = (accessor: string) => `INTERFACE I\nPROPERTY P : INT\nGET\n${accessor}END_GET\nEND_PROPERTY\nEND_INTERFACE\n`
  expect(all(itf("VAR\n\tscratch : INT;\nEND_VAR\n"))).toEqual(["Only inputs, outputs, and inouts allowed in interface methods"])
  expect(all(itf("VAR_INPUT\n\tscratch : INT;\nEND_VAR\n"))).toEqual([
    "It is not allowed to define input variables in property accessors: scratch : INT",
  ])
  expect(all(itf("VAR\nEND_VAR\n"))).toEqual([])
  expect(all(itf("VAR\n\tscratch : INT;\nEND_VAR\n"), "twincat")).toEqual([])
  // …and an interface METHOD's own VAR, by the same words
  expect(all("INTERFACE I\nMETHOD M : INT\nVAR\n\tt : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n")).toEqual([
    "Only inputs, outputs, and inouts allowed in interface methods",
  ])
  expect(all("INTERFACE I\nMETHOD M : INT\nVAR_INPUT\n\tt : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n")).toEqual([])
})

// U18 (`unit_interface_method_abstract_final`, both vendors 2026-10-01): an interface METHOD both ABSTRACT and FINAL is
// refused in the words a function block's method is
test("ABSTRACT and FINAL on an interface METHOD", () => {
  const itf = "INTERFACE I\nMETHOD ABSTRACT FINAL Get : INT\nEND_METHOD\nEND_INTERFACE\n"
  for (const vendor of ["codesys", "twincat"] as const)
    expect(all(itf, vendor)).toEqual(["A method or functionblock cannot be ABSTRACT and FINAL"])
})

// U21 (`unit_interface_method_var_temp`, `_var_stat`, `_var_inst`, both vendors 2026-10-01): an interface METHOD declares
// parameters alone — every other section is "Only inputs, outputs, and inouts allowed in interface methods", VAR_TEMP and
// VAR_INST are also not allowed in this place, and VAR_INST (an instance's variable) is a variable the interface declares
test("an interface METHOD's local sections: each is refused, in each vendor's words", () => {
  const itf = (section: string) => `INTERFACE I\nMETHOD Get : INT\n${section}\n\tt : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n`
  expect(all(itf("VAR_TEMP")).sort()).toEqual(
    ["Only inputs, outputs, and inouts allowed in interface methods", "VAR_TEMP declaration not allowed in this place"].sort(),
  )
  expect(all(itf("VAR_STAT"))).toEqual(["Only inputs, outputs, and inouts allowed in interface methods"])
  expect(all(itf("VAR_INST")).sort()).toEqual(
    [
      "Only inputs, outputs, and inouts allowed in interface methods",
      "VAR_INST declaration not allowed in this place",
      "Variable declarations are not allowed in interfaces",
    ].sort(),
  )
  expect(all(itf("VAR_TEMP"), "twincat").sort()).toEqual(
    ["Only Inputs, Outputs and Inouts allowed in Interface Methods", "'VAR_TEMP' declaration not allowed in this place"].sort(),
  )
  expect(all(itf("VAR_STAT"), "twincat")).toEqual(["Only Inputs, Outputs and Inouts allowed in Interface Methods"])
  expect(all(itf("VAR_INST"), "twincat").sort()).toEqual(
    [
      "Only Inputs, Outputs and Inouts allowed in Interface Methods",
      "'VAR_INST' declaration not allowed in this place",
      "Variable declarations are not allowed in interfaces",
    ].sort(),
  )
  expect(all(itf("VAR_IN_OUT")).concat(all(itf("VAR_OUTPUT"), "twincat"))).toEqual([])
})

// analysis-conformance 3.4 (`hdr_fb_return_type`, both vendors 2026-10-06): a FUNCTION_BLOCK's return type is C0182 as a
// PROGRAM's is — the one message, and the rest of the FB read as written
test("C0182: a return type on a FUNCTION_BLOCK is flagged, and nothing else", () => {
  const src = `FUNCTION_BLOCK FB : INT\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "return-type-not-allowed")).toEqual(["Return type is only possible for POUs of type FUNCTION and METHOD"])
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source: src }])
  const all = computeDiagnostics({ uri: "FB.pou", parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(all.map((d) => d.code)).toEqual(["return-type-not-allowed"])
})
