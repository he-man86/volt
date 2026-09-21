/**
 * fb-init-instantiation — an FB whose FB_Init takes extra inputs must be given them at the declaration.
 * Wording measured on CODESYS SP21 (conformance `fb_init_argument_left_out`); TwinCAT unmeasured.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

const FB = `FUNCTION_BLOCK FB_Needs
VAR
	started : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
started := startValue;
END_METHOD
`
const PLAIN = `FUNCTION_BLOCK FB_Plain
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK
`

function diagnose(plc: string, vendor: Vendor = "codesys") {
  const files = [
    { uri: "file:///c/FB_Needs.fb", source: FB, parseResult: parseSource(FB) },
    { uri: "file:///c/FB_Plain.fb", source: PLAIN, parseResult: parseSource(PLAIN) },
    { uri: "file:///c/PLC_PRG.prg", source: plc, parseResult: parseSource(plc) },
  ]
  const project = buildSymbolTable(files)
  const f = files[2]!
  return computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "fb-init-argument-missing")
    .map((d) => d.message)
}
const program = (decls: string) => `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM\n`

test("leaving FB_Init's extra input out is the vendor's message, verbatim", () => {
  expect(diagnose(program("\tplain : FB_Needs;"))).toEqual([
    "No matching 'FB_Init' method found for instantiation of FB_Needs. Specified 'FB_Init' method requires exactly 1 inputs. Check syntax 'plain : FB_Needs(INT)'",
  ])
  // every name in the declaration is its own instantiation
  expect(diagnose(program("\ta, b : FB_Needs;"))).toHaveLength(2)
})

test("supplying the argument is clean, and so is an FB whose FB_Init needs nothing extra", () => {
  expect(diagnose(program("\tok : FB_Needs(7);"))).toEqual([])
  expect(diagnose(program("\tp : FB_Plain;"))).toEqual([])
})

test("a declaration that constructs nothing is not an instantiation", () => {
  // VAR_IN_OUT binds to the caller's instance; a POINTER holds an address. Neither runs FB_Init.
  expect(diagnose(`FUNCTION F_Use : INT\nVAR_IN_OUT\n\tbound : FB_Needs;\nEND_VAR\nVAR\n\tp : POINTER TO FB_Needs;\nEND_VAR\nF_Use := 0;\nEND_FUNCTION\n`)).toEqual([])
})

// measured 2026-09-20 (`fb_init_argument_left_out`): TwinCAT reports it and stops at the name — no input
// count, no suggested syntax, and `FB_init` unquoted.
test("TwinCAT reports it, and stops at the name", () => {
  expect(diagnose(program("\tplain : FB_Needs;"), "twincat")).toEqual([
    "No matching FB_init method found for instantiation of FB_Needs",
  ])
})
