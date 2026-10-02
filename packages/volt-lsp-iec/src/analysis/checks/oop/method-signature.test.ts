/**
 * method-signature — C0089 (FB method vs implemented interface method) and C0094/C0568 (override vs base FB method or
 * property), rule H10. The signature is the whole parameter list — name, type and section of each, and their count — and
 * the result type, as both vendors measure it (`fixtures/names/inheritance.ts`, 2026-10-02); every name in the sentence
 * is UPPER-CASED. Only an FB the vendor compiles is checked (`analysis/compiled.ts`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** The messages of `codes` (one, or several) — every FB of the source INSTANCED by a program, as the vendor compiles only
 *  an instanced FB (`analysis/compiled.ts`). */
const msgs = (src0: string, codes: string | readonly string[], vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const fbs = [...src0.matchAll(/^FUNCTION_BLOCK (?:ABSTRACT )?(\w+)/gm)].map((m) => m[1])
  const vars = fbs.map((n, i) => `\tinst${i} : ${n};`).join("\n")
  const src = `${src0}\n\nPROGRAM P\nVAR\n${vars}\nEND_VAR\nEND_PROGRAM`
  const wanted = typeof codes === "string" ? [codes] : codes
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => wanted.includes(d.code))
    .map((d) => d.message)
}

const CONVERSION = ["override-mismatch-base", "assignment-type-mismatch"]

test("C0089: an FB method with a different param count than its interface method is flagged", () => {
  const src =
    `INTERFACE XY\nMETHOD METH1\nVAR_INPUT\n iPar : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK FB IMPLEMENTS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\nEND_VAR\nEND_METHOD`
  // CODESYS adds which part differs; TwinCAT says only the first (`inh_interface_method_param_count_mismatch`)
  expect(msgs(src, "override-mismatch-interface")).toEqual([
    "Interface of overridden method 'METH1' of interface 'XY' doesn't match declaration",
    "The number of inputs/outputs of the method 'METH1' does not correspond to the interface 'XY'.",
  ])
  expect(msgs(src, "override-mismatch-interface", "twincat")).toEqual([
    "Interface of overridden method 'METH1' of interface 'XY' doesn't match declaration",
  ])
})

test("C0089: a parameter of another type, CODESYS naming the variable (`inh_interface_method_signature_mismatch`)", () => {
  const src =
    `INTERFACE XY\nMETHOD M : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK FB IMPLEMENTS XY\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_INPUT\n a : DINT;\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-interface")).toEqual([
    "Interface of overridden method 'M' of interface 'XY' doesn't match declaration",
    "The variable 'a' of the method 'M' does not correspond to the interface 'XY'.",
  ])
})

test("C0094/C0568: an override with a different param count than the base method is flagged", () => {
  const src =
    `FUNCTION_BLOCK XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK XY2 EXTENDS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1\nVAR_INPUT\n iPar : BOOL;\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-base")).toEqual([
    "Interface of overridden method 'METH1' of base 'XY' doesn't match declaration",
  ])
})

test("a matching override (same names, types, sections and result) is not flagged", () => {
  const src =
    `FUNCTION_BLOCK XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1 : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK XY2 EXTENDS XY\nEND_FUNCTION_BLOCK\n\nMETHOD METH1 : INT\nVAR_INPUT\n A : INT;\nEND_VAR\nEND_METHOD`
  expect(msgs(src, "override-mismatch-base")).toEqual([])
})

// Each cell of the signature on its own: every name UPPER-CASED, and a parameter of another type or section then
// converted from the override's type to the base's.
const base = (m: string) => `FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK\n\n${m}\n\nFUNCTION_BLOCK D EXTENDS B\nEND_FUNCTION_BLOCK\n\n`
const mismatch = "Interface of overridden method 'FETCH' of base 'B' doesn't match declaration"
const withInput = (t: string, section = "VAR_INPUT") => `METHOD Fetch : INT\n${section}\n a : ${t};\nEND_VAR\nEND_METHOD`

test("H10: a parameter of another NAME is a mismatch (`inh_override_param_name_mismatch`)", () => {
  const src = base(withInput("INT")) + "METHOD Fetch : INT\nVAR_INPUT\n x : INT;\nEND_VAR\nEND_METHOD"
  expect(msgs(src, "override-mismatch-base")).toEqual([mismatch])
})
test("H10: a parameter of another TYPE is a mismatch and its conversion (`inh_override_signature_mismatch`)", () => {
  expect(msgs(base(withInput("INT")) + withInput("DINT"), CONVERSION)).toEqual([
    mismatch,
    "Cannot convert type 'DINT' to type 'INT'",
  ])
})
test("H10: a VAR_IN_OUT for a VAR_INPUT is a mismatch and a REFERENCE's conversion (`inh_override_section_mismatch`)", () => {
  expect(msgs(base(withInput("INT")) + withInput("INT", "VAR_IN_OUT"), CONVERSION)).toEqual([
    mismatch,
    "Cannot convert type 'REFERENCE TO INT' to type 'INT'",
  ])
})
test("H10: a VAR_INPUT for a VAR_IN_OUT is the reverse conversion, to the REFERENCE (`inh_override_inout_as_input`)", () => {
  expect(msgs(base(withInput("INT", "VAR_IN_OUT")) + withInput("INT"), CONVERSION)).toEqual([
    mismatch,
    "Cannot convert type 'INT' to type 'REFERENCE TO INT'",
  ])
})
test("H10: a VAR_OUTPUT for a VAR_INPUT of the same type is a mismatch and NO conversion (`inh_override_input_as_output`)", () => {
  // the section differs, the type passed does not: CODESYS says only the mismatch — "Cannot convert type 'INT' to type
  // 'INT'" was the LSP's own
  expect(msgs(base(withInput("INT")) + withInput("INT", "VAR_OUTPUT"), CONVERSION)).toEqual([mismatch])
})
test("H10: another RESULT type is a mismatch (`inh_override_return_type_mismatch`)", () => {
  expect(msgs(base("METHOD Fetch : INT\nEND_METHOD") + "METHOD Fetch : DINT\nEND_METHOD", "override-mismatch-base")).toEqual([mismatch])
})
test("H10: a PROPERTY of another type is its accessor method's mismatch (`inh_override_property_type_mismatch`)", () => {
  const src = base("PROPERTY P : INT\nGET\nEND_GET\nEND_PROPERTY") + "PROPERTY P : DINT\nGET\nEND_GET\nEND_PROPERTY"
  expect(msgs(src, "override-mismatch-base")).toEqual(["Interface of overridden method '__GETP' of base 'B' doesn't match declaration"])
})
test("the base compared is the nearest in the LINKED chain that declares the method", () => {
  // D EXTENDS C EXTENDS B; only B declares Fetch
  const src =
    "FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK\n\nMETHOD Fetch : INT\nEND_METHOD\n\nFUNCTION_BLOCK C EXTENDS B\nEND_FUNCTION_BLOCK\n\n" +
    "FUNCTION_BLOCK D EXTENDS C\nEND_FUNCTION_BLOCK\n\nMETHOD Fetch : DINT\nEND_METHOD"
  expect(msgs(src, "override-mismatch-base")).toEqual([mismatch])
})


test("an FB nothing instances is not checked — the vendor compiles it not (pro2193's uninstanced overrides build)", () => {
  const src = base("METHOD Fetch : INT\nEND_METHOD") + "METHOD Fetch : DINT\nEND_METHOD"
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const found = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(found.filter((d) => d.code === "override-mismatch-base")).toEqual([])
})
test("an FB reached only through a POINTER TO it is checked (`inh_override_pointer_only`); one instanced only in an FB nothing reaches is not", () => {
  const src0 = base(withInput("INT")) + withInput("DINT")
  const run = (tail: string) => {
    const src = `${src0}\n\n${tail}`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "override-mismatch-base")
      .map((d) => d.message)
  }
  expect(run("PROGRAM P\nVAR\n\tpd : POINTER TO D;\nEND_VAR\nEND_PROGRAM")).toEqual([mismatch])
  expect(run("FUNCTION_BLOCK Holder\nVAR\n\td : D;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROGRAM P\nVAR\nEND_VAR\nEND_PROGRAM")).toEqual([])
})
test("FB_init overrides nothing: a derived FB_init with inputs of its own is no mismatch", () => {
  const src =
    base("METHOD FB_init : BOOL\nVAR_INPUT\n bInitRetains : BOOL;\n bInCopyCode : BOOL;\nEND_VAR\nEND_METHOD") +
    "METHOD FB_init : BOOL\nVAR_INPUT\n bInitRetains : BOOL;\n bInCopyCode : BOOL;\n n : INT;\nEND_VAR\nEND_METHOD"
  expect(msgs(src, "override-mismatch-base")).toEqual([])
})
