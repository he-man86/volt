/**
 * abstract-instantiation — an instance of an ABSTRACT FB is refused on both vendors, each in its own wording
 * (conformance `oop_abstract_instantiated`, recorded on both: CODESYS "Function block …", TwinCAT "Functionblock …").
 * The sources below are that fixture's: the FB, and the PLC_PRG the recorder built around it; the pointer case cites
 * the fixtures that record it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const FB = `FUNCTION_BLOCK ABSTRACT FB_LANG_oop_abstract_instantiated
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inner
iVar := 1;
END_METHOD
`
const program = (decl: string) => `PROGRAM PLC_PRG
VAR
	${decl}
END_VAR
fb_absinst.Inner();
END_PROGRAM
`

function findings(prg: string, vendor: Vendor): string[] {
  const files = [FB, prg].map((source) => {
    const parseResult = parseSource(source, { networkText: true }, vendor)
    return { uri: uriFor(parseResult), source, parseResult }
  })
  const project = build.buildSymbolTable(files, [], vendor)
  const at = files[1]!
  return computeSemanticDiagnostics({ uri: at.uri, parseResult: at.parseResult, source: at.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "abstract-instantiation")
    .map((d) => `[${d.severity}] ${d.message}`)
}

test("an instance of an ABSTRACT FB is refused, in each vendor's wording (oop_abstract_instantiated)", () => {
  const prg = program("fb_absinst : FB_LANG_oop_abstract_instantiated;")
  expect(findings(prg, "codesys")).toEqual([
    "[error] Function block FB_LANG_oop_abstract_instantiated is ABSTRACT and cannot be instantiated",
  ])
  expect(findings(prg, "twincat")).toEqual([
    "[error] Functionblock FB_LANG_oop_abstract_instantiated is ABSTRACT and cannot be instantiated",
  ])
})

// recorded: `unit_method_abstract_final` (and `unit_fb_abstract_final`) reach an ABSTRACT FB from PLC_PRG through
// `POINTER TO`, and neither vendor says "cannot be instantiated" there — only the ABSTRACT-and-FINAL refusal
test("a pointer to an ABSTRACT FB instantiates nothing (unit_method_abstract_final)", () => {
  const prg = program("fb_absinst : POINTER TO FB_LANG_oop_abstract_instantiated;")
  expect(findings(prg, "codesys")).toEqual([])
  expect(findings(prg, "twincat")).toEqual([])
})

// analysis-conformance 3.7 (`oopb_abstract_array`, `oopb_abstract_assign_inout`, `oopb_abstract_as_input`, CODESYS
// 2026-10-06): an ARRAY's element is an instance, a VAR_INPUT is one, a VAR_IN_OUT binds somebody else's
const inFb = (sections: string) => `FUNCTION_BLOCK FB_LANG_user\n${sections}\nEND_FUNCTION_BLOCK\n`
function fbFindings(sections: string, vendor: Vendor): string[] {
  const files = [FB, inFb(sections)].map((source) => {
    const parseResult = parseSource(source, { networkText: true }, vendor)
    return { uri: uriFor(parseResult), source, parseResult }
  })
  const project = build.buildSymbolTable(files, [], vendor)
  const at = files[1]!
  return computeSemanticDiagnostics({ uri: at.uri, parseResult: at.parseResult, source: at.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "abstract-instantiation")
    .map((d) => d.message)
}
const REFUSED = "Function block FB_LANG_oop_abstract_instantiated is ABSTRACT and cannot be instantiated"

test("an ARRAY OF an ABSTRACT FB instantiates its elements (oopb_abstract_array)", () => {
  expect(fbFindings("VAR\n\tarr : ARRAY[1..2] OF FB_LANG_oop_abstract_instantiated;\nEND_VAR", "codesys")).toEqual([REFUSED])
})

test("a VAR_INPUT of an ABSTRACT FB's type is an instance (oopb_abstract_as_input)", () => {
  expect(fbFindings("VAR_INPUT\n\tsrc : FB_LANG_oop_abstract_instantiated;\nEND_VAR", "codesys")).toEqual([REFUSED])
})

test("a VAR_IN_OUT of an ABSTRACT FB's type instantiates nothing (oopb_abstract_assign_inout)", () => {
  expect(fbFindings("VAR_IN_OUT\n\ta : FB_LANG_oop_abstract_instantiated;\nEND_VAR", "codesys")).toEqual([])
})
