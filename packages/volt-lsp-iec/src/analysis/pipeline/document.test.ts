/**
 * `documentFindings` (`document.ts`) — one document's findings, composed: the dead-code quiet the recordings set and the
 * missing-language finding's own composition. Moved with the composition from `server/document-diagnostics.test.ts`
 * (openspec lsp-server-scheduling 2.4); the wire (codes mapped, the library gate end to end) stays the server's test.
 */
import { expect, test } from "bun:test"
import { build } from "../../frontend/symbols/index.js"
import { parseDocument } from "../../frontend/syntax/index.js"
import { codesysCodeFor, deadMemberSpans, deadPous, documentFindings, resolveConfig } from "../index.js"

/** `[code, line]` of every finding on `uri` (the compiler code where one is mapped; lines 0-based, as a client reads them), with the dead-code suppression on
 *  (the default) or off (`diagnoseDeadCode`, the control: what the same file gives when nothing is suppressed). */
function findingsIn(files: Record<string, string>, uri: string, diagnoseDeadCode = false) {
  const config = resolveConfig({ vendor: "codesys", diagnoseDeadCode })
  const docs = Object.entries(files).map(([u, source]) => ({
    uri: u,
    source,
    parseResult: parseDocument(u, source, { networkText: true }, "codesys"),
  }))
  const dead = diagnoseDeadCode ? new Set<string>() : deadPous(docs, undefined)
  return documentFindings({
    doc: docs.find((d) => d.uri === uri)!,
    project: build.buildSymbolTable(docs, [], "codesys"),
    config,
    dead,
    deadMembers: diagnoseDeadCode ? new Map() : deadMemberSpans(docs, dead),
    manifests: [],
  })
}
const lines = (files: Record<string, string>, uri: string, diagnoseDeadCode = false): [string, number][] =>
  findingsIn(files, uri, diagnoseDeadCode)
    .map((d): [string, number] => [codesysCodeFor(d.code)?.code ?? d.code, d.span.startLine - 1])
    .sort((a, b) => a[1] - b[1])

const PRG_MAIN = "PROGRAM PLC_PRG\nVAR\n\tfb : FB_Live;\nEND_VAR\n%LANGUAGE ST\nfb();\nEND_PROGRAM\n"
const LIVE_FB = "FUNCTION_BLOCK FB_Live\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"

// ONE PARSE ERROR, ONE FINDING (analysis-conformance 2.5): the pipeline's `checkParseErrors` is the one a client gets.
test("one top-level parse error is one finding", () => {
  const files = { "C:/w/H.pou": "FUNCTION_BLOCK H\nVAR\n\tx : ;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n" }
  expect(lines(files, "C:/w/H.pou")).toEqual([["C0002", 2]])
})

// DEAD CODE, RECORDED (analysis-conformance 2.5, 2026-10-06): an FB nothing reaches builds CLEAN on both vendors even
// with a parse error in it — `dead_fb_missing_then` (a statement), `dead_fb_declaration_parse_error` (a declaration) —
// so a dead POU shows nothing, parse errors included. A method nothing calls inside a LIVE FB is not skipped that way:
// its parse errors are reported on both vendors (`dead_method_missing_then`, `sig_empty_type`), so they stay.
test("a dead POU shows nothing, not even its parse errors (the build never reads it)", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    "C:/w/FB_Live.pou": LIVE_FB,
    // an FB no PROGRAM reaches: a declaration parse error (line 4), a conversion error (line 7), and a statement parse
    // error in its method (line 11)
    "C:/w/FB_Dead.pou":
      "FUNCTION_BLOCK FB_Dead\nVAR\n\tb : BOOL;\n\ti : INT;\n\tx : ;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK\n" +
      "METHOD M\n%LANGUAGE ST\nIF TRUE i := 1; END_IF\nEND_METHOD\n",
  }
  expect(lines(files, "C:/w/FB_Dead.pou", true)).toEqual([["C0002", 4], ["C0032", 7], ["C0002", 11]])
  expect(lines(files, "C:/w/FB_Dead.pou")).toEqual([])
})

test("a parse error in a dead member is still shown (recorded), the member's semantic findings are not", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    // two methods nothing calls: a declaration parse error (line 10) and a conversion error (line 13); a statement parse
    // error (line 17)
    "C:/w/FB_Live.pou":
      LIVE_FB +
      "METHOD Unused\nVAR\n\tx : ;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_METHOD\n" +
      "METHOD Unused2\n%LANGUAGE ST\nIF TRUE i := 1; END_IF\nEND_METHOD\n",
  }
  expect(lines(files, "C:/w/FB_Live.pou", true)).toEqual([["C0002", 10], ["C0032", 13], ["C0002", 17]])
  expect(lines(files, "C:/w/FB_Live.pou")).toEqual([["C0002", 10], ["C0002", 17]])
})

// THE MISSING-LANGUAGE FINDING'S COMPOSITION (pinned in gate 0b before the move, review finding 7). It is the push's own
// refusal of the file (`StReader.Unmarked`), not a compiler finding, so it does NOT follow the build's dead-code rule: a
// DEAD POU and a DEAD member with an unstated body still get it (the push refuses that file whether or not anything
// calls it), and the unstated-body quiet does not swallow it although its range lies inside that body. A Library
// Manager file gets nothing (the library gate comes first).
const UNSTATED_DEAD_FB = "FUNCTION_BLOCK FB_Dead\nVAR\n\ti : INT;\nEND_VAR\ni := 1;\nEND_FUNCTION_BLOCK\n"
const missingLanguageLines = (files: Record<string, string>, uri: string): number[] =>
  lines(files, uri)
    .filter(([code]) => code === "missing-language")
    .map(([, line]) => line)

test("missing language: a DEAD POU with an unstated body still gets the one finding (not dead-gated, not quieted)", () => {
  const files = { "C:/w/PLC_PRG.pou": PRG_MAIN, "C:/w/FB_Live.pou": LIVE_FB, "C:/w/FB_Dead.pou": UNSTATED_DEAD_FB }
  expect(missingLanguageLines(files, "C:/w/FB_Dead.pou")).toEqual([4])
})

test("missing language: a DEAD member with an unstated body inside a live FB still gets the one finding", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    "C:/w/FB_Live.pou": LIVE_FB + "METHOD Unused\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_METHOD\n",
  }
  expect(missingLanguageLines(files, "C:/w/FB_Live.pou")).toEqual([12])
})

test("missing language: a Library Manager file with an unstated body gets nothing (the library gate comes first)", () => {
  const uri = "file:///App/Library%20Manager/Lib/FB_Dead.pou"
  expect(missingLanguageLines({ [uri]: UNSTATED_DEAD_FB }, uri)).toEqual([])
})

// EXCLUDED FROM BUILD (openspec lsp-excluded-from-build): CODESYS compiles no excluded object (DIALECT C2j), so one gives
// nothing, as a dead POU gives nothing, whether reachability finds it live or not and with dead-code diagnosis on. The
// missing-language finding follows the push, so it stays.
const FB_TYPE_ERROR = "FUNCTION_BLOCK FB_Live\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK\n"

test("an excluded FB that a live PROGRAM reaches shows nothing, parse errors included", () => {
  const fb = (flag: string) =>
    `FUNCTION_BLOCK FB_Live\nVAR\n\tb : BOOL;\n\ti : INT;\n\tx : ;\nEND_VAR\n%LANGUAGE ST\n${flag}i := b;\nEND_FUNCTION_BLOCK\n`
  const built = { "C:/w/PLC_PRG.pou": PRG_MAIN, "C:/w/FB_Live.pou": fb("") }
  expect(lines(built, "C:/w/FB_Live.pou")).toEqual([["C0002", 4], ["C0032", 7]])
  const excluded = { "C:/w/PLC_PRG.pou": PRG_MAIN, "C:/w/FB_Live.pou": fb("%EXCLUDE_FROM_BUILD\n") }
  expect(lines(excluded, "C:/w/FB_Live.pou")).toEqual([])
  expect(lines(excluded, "C:/w/FB_Live.pou", true)).toEqual([])
})

test("an excluded method that an interface keeps live shows nothing; the rest of its FB still does", () => {
  const files = (flag: string) => ({
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    "C:/w/I.itf": "INTERFACE I\nMETHOD M : BOOL\nEND_METHOD\nEND_INTERFACE\n",
    "C:/w/FB_Live.pou": FB_TYPE_ERROR + `METHOD M : BOOL\n%LANGUAGE ST\n${flag}i := b;\nEND_METHOD\n`,
  })
  expect(lines(files(""), "C:/w/FB_Live.pou")).toEqual([["C0032", 6], ["C0032", 10]])
  expect(lines(files("%EXCLUDE_FROM_BUILD\n"), "C:/w/FB_Live.pou")).toEqual([["C0032", 6]])
  expect(lines(files("%EXCLUDE_FROM_BUILD\n"), "C:/w/FB_Live.pou", true)).toEqual([["C0032", 6]])
})

test("missing language: a member of an excluded FB with an unstated body still gets the one finding", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    "C:/w/FB_Live.pou":
      FB_TYPE_ERROR.replace("%LANGUAGE ST\n", "%LANGUAGE ST\n%EXCLUDE_FROM_BUILD\n") +
      "METHOD Unused\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_METHOD\n",
  }
  expect(lines(files, "C:/w/FB_Live.pou", true)).toEqual([["missing-language", 13]])
})
