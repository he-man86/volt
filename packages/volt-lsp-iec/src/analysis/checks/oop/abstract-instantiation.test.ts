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
