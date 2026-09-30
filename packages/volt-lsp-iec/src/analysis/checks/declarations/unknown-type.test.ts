/**
 * unknown-type (C0077) — a declared type that names nothing. Measured on CODESYS SP21 (2026-09-30, conformance
 * `objects/written-as-sent.ts`): a DUT or an FB whose text declares nothing (a never-closed `(*`, an empty or a
 * prose text, prose above its TYPE) leaves every declaration of its name with "Unknown type: '<name>'", and a CALL
 * of such an instance adds "Program name, function or function block instance expected instead of '<var>'".
 * Identical on TwinCAT (the e2e twin, `volt-cli/test/e2e/items/push-without-header-check.test.ts`).
 */
import { expect, test } from "bun:test"
import { parseDocument } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

type File = { uri: string; source: string }

/** Every error the analysis gives `main`, in a project of `main` and `others`. */
function errors(main: File, others: File[] = [], vendor: Vendor = "codesys"): string[] {
  const files = [main, ...others].map((f) => ({ ...f, parseResult: parseDocument(f.uri, f.source) }))
  const project = buildSymbolTable(files, [], vendor)
  const own = files[0]!
  return computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor }), uri: own.uri })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}

const prg = (decls: string, body = ";"): File => ({
  uri: "PLC_PRG.prg",
  source: `PROGRAM PLC_PRG\nVAR\n\t${decls}\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_PROGRAM\n`,
})

test("a variable of a type nothing declares — `pwh_empty_struct`, `pwh_prose_struct`", () => {
  expect(errors(prg("v : DUT_Missing;"))).toEqual(["Unknown type: 'DUT_Missing'"])
  expect(errors(prg("v : DUT_Missing;"), [{ uri: "DUT_Missing.struct", source: "this is not structured text at all\n" }])).toEqual([
    "Unknown type: 'DUT_Missing'",
  ])
})

test("…whose object's text is one comment that never closes — `pwh_unclosed_comment_struct`/`_enum`", () => {
  const unclosed = { uri: "DUT_Carrier.struct", source: "(* Carrier state\n *\nTYPE DUT_Carrier :\nSTRUCT\n\tnPos : INT;\nEND_STRUCT\nEND_TYPE\n" }
  expect(errors(prg("v : DUT_Carrier;"), [unclosed])).toEqual(["Unknown type: 'DUT_Carrier'"])
})

test("calling an instance of it adds the call target's own message — `pwh_unclosed_comment_fb`", () => {
  const unclosed = { uri: "FB_Motor.fb", source: "(* Motor\n *\nFUNCTION_BLOCK FB_Motor\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n" }
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
  const dut = { uri: "DUT_Mode.struct", source: "TYPE DUT_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n" }
  expect(errors(prg("v : DUT_Mode;"), [dut])).toEqual([])
  const fb = { uri: "FB_A.fb", source: "FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" }
  expect(errors(prg("v : FB_A;", "v();"), [fb])).toEqual([])
})

test("what the LSP has no standing to call unknown — silent", () => {
  // elementary, sized, and the compilers' own names
  expect(errors(prg("a : INT; b : STRING(10); c : __XWORD;"))).toEqual([])
  // the compilers' own named struct, built by both vendors with no library (`type_codesys_version`)
  expect(errors(prg("v : VERSION;"))).toEqual([])
  // a namespace-qualified name: the library floor
  expect(errors(prg("t : Tc2_Standard.TON;"))).toEqual([])
  // a wrapper around an unknown name is a different shape, and unmeasured
  expect(errors(prg("a : ARRAY[1..2] OF DUT_Missing; p : POINTER TO DUT_Missing;"))).toEqual([])
})

test("the generic ANY types a FUNCTION may take are not unknown", () => {
  const f = { uri: "F_Any.fun", source: "FUNCTION F_Any : BOOL\nVAR_INPUT\n\tx : ANY;\n\ty : ANY_NUM;\nEND_VAR\nIMPLEMENTATION ST\nF_Any := TRUE;\nEND_FUNCTION\n" }
  expect(errors(f)).toEqual([])
})

// `op_sys_type_class_bare` (CODESYS SP21, 2026-09-30): the system enum spelled bare — `eType : TYPE_CLASS;` and
// `TYPE_CLASS.TYPE_SUBRANGE` — builds CLEAN. The compiler provides the name, as `nameResolves` already held for its
// values; as a declared type it is no more unknown (the corpus's L_UM1P_DATASENDER declares `ETYPE : TYPE_CLASS;`).
test("a compiler-provided name is no unknown type — bare TYPE_CLASS, as `op_sys_type_class_bare` builds", () => {
  expect(errors(prg("eType : TYPE_CLASS;\n\tbSub : BOOL;", "bSub := eType = TYPE_CLASS.TYPE_SUBRANGE;"))).toEqual([])
})
