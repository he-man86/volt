/**
 * external-non-input-write — writing an FB instance's internal member from outside is refused on both vendors, in the
 * same words (conformance `hide_var`, recorded on both: "'iSecret' is no input of 'FB_LANG_hide_var'", one per write).
 * The sources below are that fixture's, unchanged: the FB, and the PLC_PRG the recorder built around it. (Writing an
 * input from outside, or reading an internal member, is recorded by no fixture, so no test here claims either.)
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, type Vendor } from "../../index.js"
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
  return computeDiagnostics({ uri: at.uri, parseResult: at.parseResult, source: at.source, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "external-non-input-write")
    .map((d) => `[${d.severity}] ${d.message}`)
}

test("each write of an internal member from outside is refused, the same words on both vendors (hide_var)", () => {
  const body = "fb_hide.iSecret := 1;\nfb_hide.iVisible := 2;"
  const expected = ["[error] 'iSecret' is no input of 'FB_LANG_hide_var'", "[error] 'iVisible' is no input of 'FB_LANG_hide_var'"]
  expect(findings(body, "codesys")).toEqual(expected)
  expect(findings(body, "twincat")).toEqual(expected)
})

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06): a VAR_OUTPUT is not writable from outside either —
// "'o' is no input of 'FB'" (`oopa_write_output`) — and a VAR_TEMP lives in the FB's BODY, which the message names:
// "'scratch' is no input of '__MAIN'" (`oopa_write_var_temp`). Reading a plain VAR from outside builds (`oopa_read_internal_var`).
test("a VAR_OUTPUT written from outside is no input; a VAR_TEMP is no input of the body, __MAIN", () => {
  const fb = `FUNCTION_BLOCK FB_W\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nVAR_TEMP\n\tscratch : INT;\nEND_VAR\nVAR\n\thidden : INT;\nEND_VAR\nscratch := 1;\nEND_FUNCTION_BLOCK\n`
  const prg = (body: string) => `PROGRAM PLC_PRG\nVAR\n\tw : FB_W;\n\tn : INT;\nEND_VAR\n${body}\nEND_PROGRAM\n`
  const run = (body: string, vendor: Vendor) => {
    const files = [fb, prg(body)].map((source) => {
      const parseResult = parseSource(source, { networkText: true }, vendor)
      return { uri: uriFor(parseResult), source, parseResult }
    })
    const project = build.buildSymbolTable(files, [], vendor)
    const at = files[1]!
    return computeDiagnostics({ uri: at.uri, parseResult: at.parseResult, source: at.source, project, config: resolveConfig({ vendor }) }).map((d) => d.message)
  }
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(run("w.o := 2;", vendor)).toEqual(["'o' is no input of 'FB_W'"])
    expect(run("w.scratch := 2;", vendor)).toEqual(["'scratch' is no input of '__MAIN'"])
    expect(run("n := w.hidden;\nn := w.o;", vendor)).toEqual([])
  }
})
