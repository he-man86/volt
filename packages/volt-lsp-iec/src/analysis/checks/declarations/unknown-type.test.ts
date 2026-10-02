/**
 * unknown-type (C0077) — a declared type that names nothing. Measured on CODESYS SP21 (2026-09-30, conformance
 * `objects/written-as-sent.ts`): a DUT or an FB whose text declares nothing (a never-closed `(*`, an empty or a
 * prose text, prose above its TYPE) leaves every declaration of its name with "Unknown type: '<name>'", and a CALL
 * of such an instance adds "Program name, function or function block instance expected instead of '<var>'".
 * Identical on TwinCAT (the e2e twin, `volt-cli/test/e2e/items/push-without-header-check.test.ts`).
 */
import { expect, test } from "bun:test"
import { parseDocument } from "../../../frontend/syntax/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"
import { build } from "../../../frontend/symbols/index.js"

type File = { uri: string; source: string }

/** Every error the analysis gives `main`, in a project of `main` and `others`. */
function errors(main: File, others: File[] = [], vendor: Vendor = "codesys"): string[] {
  const files = [main, ...others].map((f) => ({ ...f, parseResult: parseDocument(f.uri, f.source, { networkText: true }, vendor) }))
  const project = build.buildSymbolTable(files, [], vendor)
  const own = files[0]!
  return computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor }), uri: own.uri })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}

const prg = (decls: string, body = ";"): File => ({
  uri: "PLC_PRG.pou",
  source: `PROGRAM PLC_PRG\nVAR\n\t${decls}\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_PROGRAM\n`,
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
  const unclosed = { uri: "FB_Motor.pou", source: "(* Motor\n *\nFUNCTION_BLOCK FB_Motor\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n" }
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
  const fb = { uri: "FB_A.pou", source: "FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" }
  expect(errors(prg("v : FB_A;", "v();"), [fb])).toEqual([])
})

test("what the LSP has no standing to call unknown — silent", () => {
  // elementary, sized, and the compilers' own names
  expect(errors(prg("a : INT; b : STRING(10); c : __XWORD;"))).toEqual([])
  // the compilers' own named struct, built by both vendors with no library (`type_codesys_version`)
  expect(errors(prg("v : VERSION;"))).toEqual([])
  // a wrapper around an unknown name is a different shape, and unmeasured
  expect(errors(prg("a : ARRAY[1..2] OF DUT_Missing; p : POINTER TO DUT_Missing;"))).toEqual([])
})

test("the generic ANY types a FUNCTION may take are not unknown", () => {
  const f = { uri: "F_Any.pou", source: "FUNCTION F_Any : BOOL\nVAR_INPUT\n\tx : ANY;\n\ty : ANY_NUM;\nEND_VAR\nIMPLEMENTATION ST\nF_Any := TRUE;\nEND_FUNCTION\n" }
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
  const f = { uri: "F_Stamp.pou", source: "FUNCTION F_Stamp : LDT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n" }
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
  const project = build.buildSymbolTable(files, [{ uri: "w/Library Manager/Lib/Lib.library", folder: "Lib", namespace: "Ns", library: "Lib", dependencies: [], materialization: 4 }])
  const own = files[0]!
  const said = computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor: "codesys" }), uri: own.uri })
  expect(said.filter((d) => d.severity === "error").map((d) => d.message)).toEqual([])
  // on TwinCAT the LSP cannot know that nothing declares a type (its materialization is partial), qualified or not
  expect(errors(prg("v : NoSuchLib.T;"), [], "twincat")).toEqual([])
})
