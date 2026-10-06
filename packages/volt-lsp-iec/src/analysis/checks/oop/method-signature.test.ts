/**
 * method-signature — C0089 (FB method vs implemented interface method) and C0094/C0568 (override vs base FB method or
 * property), rule H10. The signature is the whole parameter list — name, type and section of each, and their count — and
 * the result type, as both vendors measure it (`fixtures/names/inheritance.ts`, 2026-10-02); every name in the sentence
 * is UPPER-CASED. Only an FB the vendor compiles is checked (`analysis/shared/compiled.ts`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

/** The messages of `codes` (one, or several) — every FB of the source INSTANCED by a program, as the vendor compiles only
 *  an instanced FB (`analysis/shared/compiled.ts`). */
const msgs = (src0: string, codes: string | readonly string[], vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const fbs = [...src0.matchAll(/^FUNCTION_BLOCK (?:ABSTRACT )?(\w+)/gm)].map((m) => m[1])
  const vars = fbs.map((n, i) => `\tinst${i} : ${n};`).join("\n")
  const src = `${src0}\n\nPROGRAM P\nVAR\n${vars}\nEND_VAR\nEND_PROGRAM`
  const wanted = typeof codes === "string" ? [codes] : codes
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
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
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  const found = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(found.filter((d) => d.code === "override-mismatch-base")).toEqual([])
})
test("an FB reached only through a POINTER TO it is checked (`inh_override_pointer_only`); one instanced only in an FB nothing reaches is not", () => {
  const src0 = base(withInput("INT")) + withInput("DINT")
  const run = (tail: string) => {
    const src = `${src0}\n\n${tail}`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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

// ─── analysis-conformance 3.7 (`oopb_*`, both vendors 2026-10-06) ───────────────────────────────────────────────────
const ITF_M = `INTERFACE XY\nMETHOD M : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n`
const IMPL = (method: string, header = " IMPLEMENTS XY") => `${ITF_M}FUNCTION_BLOCK FB${header}\nEND_FUNCTION_BLOCK\n\n${method}`
const FIRST = "Interface of overridden method 'M' of interface 'XY' doesn't match declaration"
const COUNT = "The number of inputs/outputs of the method 'M' does not correspond to the interface 'XY'."

test("C0089: another SECTION is a COUNT difference — the inputs, outputs and inouts are counted apart (oopb_itf_section_mismatch)", () => {
  const src = IMPL("METHOD M : INT\nVAR_IN_OUT\n a : INT;\nEND_VAR\nEND_METHOD")
  expect(msgs(src, "override-mismatch-interface")).toEqual([FIRST, COUNT])
  expect(msgs(src, "override-mismatch-interface", "twincat")).toEqual([FIRST])
})

test("C0089: another result type names the method as the variable; no result is a COUNT difference (oopb_itf_return_*)", () => {
  expect(msgs(IMPL("METHOD M : DINT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD"), "override-mismatch-interface")).toEqual([
    FIRST,
    "The variable 'M' of the method 'M' does not correspond to the interface 'XY'.",
  ])
  expect(msgs(IMPL("METHOD M\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD"), "override-mismatch-interface")).toEqual([FIRST, COUNT])
})

test("C0089: the interface's method provided by the FB's BASE is compared too (oopb_itf_method_in_base_mismatch)", () => {
  const src =
    `${ITF_M}FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_INPUT\n a : DINT;\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK FB EXTENDS B IMPLEMENTS XY\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "override-mismatch-interface")).toEqual([FIRST, "The variable 'a' of the method 'M' does not correspond to the interface 'XY'."])
  expect(msgs(src, "override-mismatch-interface", "twincat")).toEqual([FIRST])
})

test("C0094: a PROPERTY whose SET overrides another type converts its value; a VAR_OUTPUT of another type converts nothing", () => {
  const prop =
    `FUNCTION_BLOCK B\nVAR\n b : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\nP := b;\nEND_GET\nSET\nb := P;\nEND_SET\nEND_PROPERTY\n\n` +
    `FUNCTION_BLOCK D EXTENDS B\nVAR\n s : DINT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : DINT\nGET\nP := s;\nEND_GET\nSET\ns := P;\nEND_SET\nEND_PROPERTY`
  for (const vendor of ["codesys", "twincat"] as const)
    expect(msgs(prop, CONVERSION, vendor)).toEqual([
      "Interface of overridden method '__GETP' of base 'B' doesn't match declaration",
      "Interface of overridden method '__SETP' of base 'B' doesn't match declaration",
      "Cannot convert type 'DINT' to type 'INT'",
    ])
  const out =
    `FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_OUTPUT\n o : INT;\nEND_VAR\nEND_METHOD\n\n` +
    `FUNCTION_BLOCK D EXTENDS B\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_OUTPUT\n o : DINT;\nEND_VAR\nEND_METHOD`
  expect(msgs(out, CONVERSION)).toEqual(["Interface of overridden method 'M' of base 'B' doesn't match declaration"])
})

test("C0089: an interface method INHERITED from the base is said at the FB's IMPLEMENTS, in the FB's own file (gate 3.7+3.9)", () => {
  // one item per file: the base's method and parameter live in FB_Base.pou — the derived FB's finding cannot carry their
  // offsets into FB_D.pou (CODESYS records the finding without a position, line 0)
  const files = {
    "ITF_X.itf": `INTERFACE ITF_X\nMETHOD M : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE`,
    "FB_Base.pou": `FUNCTION_BLOCK FB_Base\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_INPUT\n a : DINT;\nEND_VAR\nEND_METHOD`,
    "FB_D.pou": `FUNCTION_BLOCK FB_D EXTENDS FB_Base IMPLEMENTS ITF_X\nVAR\n out : INT;\nEND_VAR\nout := M(a := 3);\nEND_FUNCTION_BLOCK`,
    "P.pou": `PROGRAM P\nVAR\n d : FB_D;\nEND_VAR\nEND_PROGRAM`,
  }
  const parsed = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(parsed, [], "codesys")
  const d = parsed.find((f) => f.uri === "FB_D.pou")!
  const found = computeSemanticDiagnostics({ uri: d.uri, parseResult: d.parseResult, source: d.source, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((x) => x.code === "override-mismatch-interface")
  const at = d.source.indexOf("ITF_X")
  expect(found.map((x) => [x.message, d.source.slice(x.span.start, x.span.end)])).toEqual([
    ["Interface of overridden method 'M' of interface 'ITF_X' doesn't match declaration", "ITF_X"],
    ["The variable 'a' of the method 'M' does not correspond to the interface 'ITF_X'.", "ITF_X"],
  ])
  expect(found.every((x) => x.span.start === at)).toBe(true)
})
