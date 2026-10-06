/**
 * fb-init-instantiation — an FB whose FB_Init takes extra inputs must be given them at the declaration.
 * Wording measured on CODESYS SP21 (conformance `fb_init_argument_left_out`); TwinCAT unmeasured.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"
import { uriFor } from "../../test-uri.js"

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
    { uri: "file:///c/FB_Needs.pou", source: FB, parseResult: parseSource(FB, { networkText: true }, vendor) },
    { uri: "file:///c/FB_Plain.pou", source: PLAIN, parseResult: parseSource(PLAIN, { networkText: true }, vendor) },
    { uri: "file:///c/PLC_PRG.pou", source: plc, parseResult: parseSource(plc, { networkText: true }, vendor) },
  ]
  const project = build.buildSymbolTable(files, [], vendor)
  const f = files[2]!
  return computeSemanticDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor }) })
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

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06): a WRONG COUNT of FB_Init arguments is the same message as
// none (`oopa_fb_init_two_arguments`), and an ARRAY of such an FB with no initializers counts them against its elements
// (`oopa_fb_init_array_left_out`)
test("FB_Init given the wrong count of arguments is the same message; an ARRAY of it counts its initializers", () => {
  expect(diagnose(program("\tt : FB_Needs(3, 4);"))).toEqual([
    "No matching 'FB_Init' method found for instantiation of FB_Needs. Specified 'FB_Init' method requires exactly 1 inputs. Check syntax 't : FB_Needs(INT)'",
  ])
  expect(diagnose(program("\tt : FB_Needs(3, 4);"), "twincat")).toEqual(["No matching FB_init method found for instantiation of FB_Needs"])
  expect(diagnose(program("\tts : ARRAY[1..2] OF FB_Needs;"))).toEqual(["The number of 'FB_Init' initializers (0) does not match the number of array elements (2)"])
  expect(diagnose(program("\tts : ARRAY[1..2] OF FB_Needs;"), "twincat")).toEqual(["The number of FB_Init-Initializers (0) does not match the number of Array-Elements (2)"])
  expect(diagnose(program("\tps : ARRAY[1..2] OF FB_Plain;"))).toEqual([])
  // the element's arguments written once, for every element (pro2193 builds `ARRAY[1..3] OF GuardRealFB(moduleHandler := …)`)
  expect(diagnose(program("\tts : ARRAY[1..2] OF FB_Needs(startValue := 4);"))).toEqual([])
})

// gate review (3.4+3.6): the array count is measured in an FB's (and a PROGRAM's) VAR only — a FUNCTION's VAR_INPUT array
// of such an FB was not asked, so no count there
test("an ARRAY of an FB_Init FB in a FUNCTION's VAR_INPUT is not counted (unmeasured)", () => {
  expect(diagnose(`FUNCTION F : INT\nVAR_INPUT\n\ta : ARRAY[0..1] OF FB_Needs;\nEND_VAR\nF := 1;\nEND_FUNCTION\n`).filter((m) => m.startsWith("The number"))).toEqual([])
})
