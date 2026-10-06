/**
 * external-non-input-write — writing an FB instance's internal member from outside is refused on both vendors, in the
 * same words (conformance `hide_var`, recorded on both: "'iSecret' is no input of 'FB_LANG_hide_var'", one per write).
 * The sources below are that fixture's, unchanged: the FB, and the PLC_PRG the recorder built around it. (Writing an
 * input from outside, or reading an internal member, is recorded by no fixture, so no test here claims either.)
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const FB = `FUNCTION_BLOCK FB_LANG_hide_var
VAR
	{attribute 'hide'}
	iSecret : INT;
	iVisible : INT;
END_VAR

END_FUNCTION_BLOCK
`
const program = (body: string) => `PROGRAM PLC_PRG
VAR
	fb_hide : FB_LANG_hide_var;
END_VAR
${body}
END_PROGRAM
`

function findings(body: string, vendor: Vendor): string[] {
  const files = [FB, program(body)].map((source) => {
    const parseResult = parseSource(source, { networkText: true }, vendor)
    return { uri: uriFor(parseResult), source, parseResult }
  })
  const project = build.buildSymbolTable(files, [], vendor)
  const at = files[1]!
  return computeSemanticDiagnostics({ uri: at.uri, parseResult: at.parseResult, source: at.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "external-non-input-write")
    .map((d) => `[${d.severity}] ${d.message}`)
}

test("each write of an internal member from outside is refused, the same words on both vendors (hide_var)", () => {
  const body = "fb_hide.iSecret := 1;\nfb_hide.iVisible := 2;"
  const expected = ["[error] 'iSecret' is no input of 'FB_LANG_hide_var'", "[error] 'iVisible' is no input of 'FB_LANG_hide_var'"]
  expect(findings(body, "codesys")).toEqual(expected)
  expect(findings(body, "twincat")).toEqual(expected)
})
