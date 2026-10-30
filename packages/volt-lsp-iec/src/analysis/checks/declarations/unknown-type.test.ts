/**
 * unknown-type (C0077) — a declared type that names nothing. Measured on CODESYS SP21 (2026-09-30, conformance
 * `objects/written-as-sent.ts`): a DUT or an FB whose text declares nothing (a never-closed `(*`, an empty or a
 * prose text, prose above its TYPE) leaves every declaration of its name with "Unknown type: '<name>'", and a CALL
 * of such an instance adds "Program name, function or function block instance expected instead of '<var>'".
 * Identical on TwinCAT (the e2e twin, `volt-cli/test/e2e/items/push-without-header-check.test.ts`).
 */
import { expect, test } from "bun:test"
import { parseDocument } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"
import { build } from "../../../frontend/symbols/index.js"

type File = { uri: string; source: string }

/** Every error the analysis gives `main`, in a project of `main` and `others`. */
function errors(main: File, others: File[] = [], vendor: Vendor = "codesys"): string[] {
  const files = [main, ...others].map((f) => ({ ...f, parseResult: parseDocument(f.uri, f.source, { networkText: true }, vendor) }))
  const project = build.buildSymbolTable(files, [], vendor)
  const own = files[0]!
  return computeDiagnostics({ parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor }), uri: own.uri })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}

const prg = (decls: string, body = ";"): File => ({
  uri: "PLC_PRG.pou",
  source: `PROGRAM PLC_PRG\nVAR\n\t${decls}\nEND_VAR\n%LANGUAGE ST\n${body}\nEND_PROGRAM\n`,
})

test("a variable of a type nothing declares — `pwh_empty_struct`, `pwh_prose_struct`", () => {
  expect(errors(prg("v : DUT_Missing;"))).toEqual(["Unknown type: 'DUT_Missing'"])
  expect(errors(prg("v : DUT_Missing;"), [{ uri: "DUT_Missing.dut", source: "this is not structured text at all\n" }])).toEqual([
    "Unknown type: 'DUT_Missing'",
  ])
})

test("…whose object's text is one comment that never closes — `pwh_unclosed_comment_struct`/`_enum`", () => {
  const unclosed = { uri: "DUT_Carrier.dut", source: "(* Carrier state\n *\nTYPE DUT_Carrier :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n" }
  expect(errors(prg("v : DUT_Carrier;"), [unclosed])).toEqual(["Unknown type: 'DUT_Carrier'"])
})

test("calling an instance of it adds the call target's own message — `pwh_unclosed_comment_fb`", () => {
  const unclosed = { uri: "FB_Motor.pou", source: "(* Motor\n *\nFUNCTION_BLOCK FB_Motor\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n" }
  expect(errors(prg("v : FB_Motor;", "v();"), [unclosed])).toEqual([
    "Program name, function or function block instance expected instead of 'v'",
    "Unknown type: 'FB_Motor'",
  ])
})

// TwinCAT says the same (the e2e twin), but the LSP has no standing to: its `References/` materialization lacks types
// the compiler knows (External Types, `ST_LibVersion` — corpus `twincat-project14`). A known divergence, not a rule.
test("on TwinCAT the LSP cannot know that nothing declares a type, and stays silent", () => {
  expect(errors(prg("v : FB_Motor;", "v();"), [], "twincat")).toEqual([])
  expect(errors(prg("h : HRESULT;"), [], "twincat")).toEqual([])
})

test("a type the project declares, in whatever object — silent", () => {
  const dut = { uri: "DUT_Mode.dut", source: "TYPE DUT_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n" }
  expect(errors(prg("v : DUT_Mode;"), [dut])).toEqual([])
  const fb = { uri: "FB_A.pou", source: "FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n" }
  expect(errors(prg("v : FB_A;", "v();"), [fb])).toEqual([])
})

test("what the LSP has no standing to call unknown — silent", () => {
  // elementary, sized, and the compilers' own names
  expect(errors(prg("a : INT; b : STRING(10); c : __XWORD;"))).toEqual([])
  // the compilers' own named struct, built by both vendors with no library (`type_codesys_version`)
  expect(errors(prg("v : VERSION;"))).toEqual([])
})

// THE CLASS SWEEP (openspec dut-unknown-field-type, conformance `declarations/type-references.ts`, CODESYS SP21
// 2026-10-30): every position a declaration writes a type in reports a name nothing declares. This test said a wrapper
// (`ARRAY OF X`, `POINTER TO X`) was "a different shape, and unmeasured" and stayed silent; the recordings measured it.
test("the name inside an ARRAY, a POINTER, a REFERENCE — `tref_array_*`, `tref_pointer_to*`, `tref_reference_to`", () => {
  const one = ["Unknown type: 'DUT_Missing'"]
  expect(errors(prg("a : ARRAY[1..2] OF DUT_Missing;"))).toEqual(one)
  expect(errors(prg("a : ARRAY[1..2, 0..1] OF DUT_Missing;"))).toEqual(one)
  expect(errors(prg("a : ARRAY[1..2] OF ARRAY[0..1] OF DUT_Missing;"))).toEqual(one)
  expect(errors(prg("p : POINTER TO DUT_Missing;"))).toEqual(one)
  expect(errors(prg("rf : REFERENCE TO DUT_Missing;"))).toEqual(one)
  expect(errors(prg("p : POINTER TO ARRAY[0..1] OF DUT_Missing;"))).toEqual(one)
})

test("one per name declared — `tref_var_two_names`", () => {
  expect(errors(prg("a, b : DUT_Missing;"))).toEqual(["Unknown type: 'DUT_Missing'", "Unknown type: 'DUT_Missing'"])
})

/** Every error the analysis gives each of `files`, as `<uri>@<line>:<column> <message>` (1-based, as an editor shows it). */
function located(files: File[]): string[] {
  const parsed = files.map((f) => ({ ...f, parseResult: parseDocument(f.uri, f.source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(parsed, [], "codesys")
  return parsed.flatMap((f) =>
    computeDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }), uri: f.uri })
      .filter((d) => d.severity === "error")
      .map((d) => `${f.uri}@${d.span.startLine}:${d.span.startCol + 1} ${d.message}`),
  )
}

// Sim-Assist's repro (proposal.md): the error is the DUT's, on the field's type, and the program using it says nothing.
test("a STRUCT field of an unknown type is reported on its type, in the DUT — `tref_struct_field`", () => {
  const dut = { uri: "ST_Data.dut", source: "TYPE ST_Data :\nSTRUCT\n\tvalue : INT;\n\tother : NoSuchType;\nEND_STRUCT\nEND_TYPE\n" }
  const main = { uri: "Main.pou", source: "PROGRAM Main\nVAR\n\td : ST_Data;\nEND_VAR\n%LANGUAGE ST\nd.value := 1;\nEND_PROGRAM\n" }
  expect(located([dut, main])).toEqual(["ST_Data.dut@4:10 Unknown type: 'NoSuchType'"])
})

test("a UNION field, an alias's target, a field of an ARRAY or a POINTER — `tref_union_field`, `tref_alias`, `tref_struct_field_*`", () => {
  const dut = (body: string): File => ({ uri: "DUT_X.dut", source: `TYPE DUT_X ${body}\nEND_TYPE\n` })
  const one = ["Unknown type: 'NoSuchType'"]
  expect(errors(dut(":\nUNION\n\tvalue : INT;\n\tother : NoSuchType;\nEND_UNION"))).toEqual(one)
  expect(errors(dut(": NoSuchType;"))).toEqual(one)
  expect(errors(dut(":\nSTRUCT\n\tother : ARRAY[0..1] OF NoSuchType;\nEND_STRUCT"))).toEqual(one)
  expect(errors(dut(":\nSTRUCT\n\tother : POINTER TO NoSuchType;\nEND_STRUCT"))).toEqual(one)
})

test("a field of a known DUT, of an FB type and of an elementary type — silent", () => {
  const known = { uri: "DUT_Known.dut", source: "TYPE DUT_Known :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n" }
  const fb = { uri: "FB_Known.pou", source: "FUNCTION_BLOCK FB_Known\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n" }
  const holder = { uri: "DUT_H.dut", source: "TYPE DUT_H :\nSTRUCT\n\ta : DUT_Known;\n\tb : FB_Known;\n\tc : ARRAY[0..1] OF DUT_Known;\n\td : LREAL;\nEND_STRUCT\nEND_TYPE\n" }
  expect(errors(holder, [known, fb])).toEqual([])
})

test("every VAR section, a GVL's and a METHOD's VAR_INST — `tref_var_*`", () => {
  const fb = (sections: string): File => ({ uri: "FB_X.pou", source: `FUNCTION_BLOCK FB_X\n${sections}\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n` })
  for (const section of ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT"])
    expect(errors(fb(`${section}\n\tv : NoSuchType;\nEND_VAR`))).toEqual(["Unknown type: 'NoSuchType'"])
  expect(errors({ uri: "G.gvl", source: "VAR_GLOBAL\n\tg : NoSuchType;\nEND_VAR\n" })).toEqual(["Unknown type: 'NoSuchType'"])
  expect(errors({ uri: "FB_X.M.pou", source: "METHOD M\nVAR_INST\n\tv : NoSuchType;\nEND_VAR\n%LANGUAGE ST\n;\nEND_METHOD\n" })).toEqual(["Unknown type: 'NoSuchType'"])
})

test("a FUNCTION's, a METHOD's and an INTERFACE METHOD's result, an interface method's input — `tref_*_return`, `tref_interface_method_input`", () => {
  const one = ["Unknown type: 'NoSuchType'"]
  expect(errors({ uri: "F.pou", source: "FUNCTION F : NoSuchType\nVAR_INPUT\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION\n" })).toEqual(one)
  expect(errors({ uri: "FB_X.M.pou", source: "METHOD M : NoSuchType\n%LANGUAGE ST\n;\nEND_METHOD\n" })).toEqual(one)
  expect(errors({ uri: "I.itf", source: "INTERFACE I\nMETHOD M : NoSuchType\nEND_METHOD\nEND_INTERFACE\n" })).toEqual(one)
  expect(errors({ uri: "I.itf", source: "INTERFACE I\nMETHOD M : BOOL\nVAR_INPUT\n\tx : NoSuchType;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n" })).toEqual(one)
})

// A PROPERTY is its accessors: the property and each accessor carry the type, one message each (SET only: 2, an interface
// property with a GET: 2), and an interface property with NEITHER compiles nothing (`tref_interface_property_type`: a
// warning, no "Unknown type"). A GET's implementation adds one more and a conversion — a known divergence (`support/divergences.ts`).
test("a PROPERTY: one per thing declared of its type — `tref_property_type_set`, `tref_interface_property_*`", () => {
  const unknown = (n: number) => Array.from({ length: n }, () => "Unknown type: 'NoSuchType'")
  const prop = (accessors: string): File => ({ uri: "FB_X.P.pou", source: `PROPERTY P : NoSuchType\n${accessors}END_PROPERTY\n` })
  expect(errors(prop("SET\n%LANGUAGE ST\n;\nEND_SET\n"))).toEqual(unknown(2))
  expect(errors(prop("GET\n%LANGUAGE ST\n;\nEND_GET\nSET\n%LANGUAGE ST\n;\nEND_SET\n"))).toEqual(unknown(3))
  const itf = (accessors: string): File => ({ uri: "I.itf", source: `INTERFACE I\nPROPERTY P : NoSuchType\n${accessors}END_PROPERTY\nEND_INTERFACE\n` })
  expect(errors(itf("GET\nEND_GET\n"))).toEqual(unknown(2))
  expect(errors(itf(""))).toEqual([])
})

// A PROPERTY with NO type (`PROPERTY P`, `PROPERTY P :`) holds the empty type, which names nothing to look up: its refusal is
// the parser's (`rcc_property_no_type`, `rcc_property_empty_type`) — the sweep's first census gave "Unknown type: ''" ×2.
test("a PROPERTY that declares no type is no unknown type", () => {
  for (const header of ["PROPERTY P", "PROPERTY P :"])
    for (const vendor of ["codesys", "twincat"] as const)
      expect(errors({ uri: "FB_X.P.pou", source: `${header}\nGET\n%LANGUAGE ST\n;\nEND_GET\nEND_PROPERTY\n` }, [], vendor).filter((m) => m.startsWith("Unknown type"))).toEqual([])
})

test("the generic ANY types a FUNCTION may take are not unknown", () => {
  const f = { uri: "F_Any.pou", source: "FUNCTION F_Any : BOOL\nVAR_INPUT\n\tx : ANY;\n\ty : ANY_NUM;\nEND_VAR\n%LANGUAGE ST\nF_Any := TRUE;\nEND_FUNCTION\n" }
  expect(errors(f)).toEqual([])
})

// `op_sys_type_class_bare` (CODESYS SP21, 2026-09-30): the system enum spelled bare — `eType : TYPE_CLASS;` and
// `TYPE_CLASS.TYPE_SUBRANGE` — builds CLEAN. The compiler provides the name, as `nameResolves` already held for its
// values; as a declared type it is no more unknown (the corpus's L_UM1P_DATASENDER declares `ETYPE : TYPE_CLASS;`).
test("a compiler-provided name is no unknown type — bare TYPE_CLASS, as `op_sys_type_class_bare` builds", () => {
  expect(errors(prg("eType : TYPE_CLASS;\n\tbSub : BOOL;", "bSub := eType = TYPE_CLASS.TYPE_SUBRANGE;"))).toEqual([])
})

// A FUNCTION's RETURN type is a declared type too. TwinCAT reports a CODESYS-only elementary return type on the header
// line, before anything the body says (`xf_ldt_to_date_call_once` and its four siblings, TwinCAT 2026-10-01: "Unknown
// type: 'LDT'" at line 1). Only the dialect half is measured there: a bare unknown name as a return type is not.
test("a FUNCTION returning a CODESYS-only elementary type, on TwinCAT — the return type is a declaration", () => {
  const f = { uri: "F_Stamp.pou", source: "FUNCTION F_Stamp : LDT\nVAR_INPUT\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION\n" }
  expect(errors(f, [], "twincat")).toEqual(["Unknown type: 'LDT'"])
  expect(errors(f, [], "codesys")).toEqual([])
})

// A QUALIFIED name (frontend-conformance 3.4.2, rules LB1/LB8). Measured, both vendors 2026-10-01: `v : NoSuchLib.T;` is
// "Unknown type: 'NoSuchLib.T'" (`decl_type_unknown_qualified`) — a qualifier that names nothing. This test said a
// namespace-qualified name was "the library floor" and stayed silent: a deliberate narrowness from before the vendor was
// asked, which the recording answers.
test("a qualified type whose qualifier names nothing — `decl_type_unknown_qualified`", () => {
  expect(errors(prg("v : NoSuchLib.T;"))).toEqual(["Unknown type: 'NoSuchLib.T'"])
  expect(errors(prg("t : Tc2_Standard.TON;"))).toEqual(["Unknown type: 'Tc2_Standard.TON'"])
})

test("a qualified type whose first qualifier names something — silent", () => {
  // the compiler's own namespace (corpus: `M_TYPE : __SYSTEM.TYPE_CLASS`)
  expect(errors(prg("m : __SYSTEM.TYPE_CLASS;"))).toEqual([])
  // a library namespace — whatever it holds: a library's namespace reaches the elements of a dependency it PUBLISHES
  // (corpus: `L_IE1P.L_IE1P_SeverityLevel`, 51 such references in two projects that build) and not those of one it does
  // not (`DED.IO_SYSTEM_TYPE` is "Unknown type", `lib_ns_direct_dependency_only`); the manifest does not say which (LB2)
  const lib = { uri: "w/Library Manager/Lib/T.dut", source: "TYPE T :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n" }
  const files = [prg("a : Ns.T; b : Ns.Elsewhere;"), lib].map((f) => ({ ...f, parseResult: parseDocument(f.uri, f.source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(files, [{ uri: "w/Library Manager/Lib/Lib.library", folder: "Lib", dir: "w/Library Manager/Lib/", namespace: "Ns", library: "Lib", dependencies: [], materialization: 4 }], "codesys")
  const own = files[0]!
  const said = computeDiagnostics({ parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor: "codesys" }), uri: own.uri })
  expect(said.filter((d) => d.severity === "error").map((d) => d.message)).toEqual([])
  // on TwinCAT the LSP cannot know that nothing declares a type (its materialization is partial), qualified or not
  expect(errors(prg("v : NoSuchLib.T;"), [], "twincat")).toEqual([])
})
