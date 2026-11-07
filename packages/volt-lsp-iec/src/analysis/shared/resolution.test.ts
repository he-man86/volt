/**
 * A NAME A GLOBAL SHARES, AND AN INTEGER READ WITH A MEMBER (`scalarMemberBases`, reported `not-structured`). The global is what a shared name means in
 * a body (step 5 before 8), and an integer read with a member nothing declares is no structured variable, typed BIT.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../index.js"
import { uriFor } from "../../../test/support/test-uri.js"

function diag(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys", undefined, [])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}

const fb = (varsAndBody: string) => `FUNCTION_BLOCK F\n${varsAndBody}\nEND_FUNCTION_BLOCK`

// `sio_program_global_name`, CODESYS 3.5.21.40: the three messages below; `enum_library_member_vs_project_program` says the
// same of an enum member. A constant bit index (`w.c`) stays a bit access.
test("a global sharing a PROGRAM's name wins it: no call, and its member read is no structured variable", () => {
  const src =
    "PROGRAM SioInfeed\nVAR\n\tk : INT;\nEND_VAR\nk := 1;\nEND_PROGRAM\n\nVAR_GLOBAL\n\tSioInfeed : INT;\nEND_VAR\n\n" +
    "FUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\nSioInfeed();\nout := SioInfeed.k;\nEND_FUNCTION_BLOCK\n"
  expect(diag(src).filter((d) => d.severity === "error").map((d) => d.message).sort()).toEqual([
    "'SioInfeed' is no structured variable",
    "Cannot convert type 'BIT' to type 'INT'",
    "Program name, function or function block instance expected instead of 'SioInfeed'",
  ])
})

test("an integer read with a member nothing declares is no structured variable; with a constant it is a bit", () => {
  const said = (body: string) =>
    diag(fb(`VAR\n\ti : INT;\n\tw : WORD;\n\tb : BOOL;\nEND_VAR\nVAR CONSTANT\n\tc : INT := 3;\nEND_VAR\n${body}`)).map((d) => d.message)
  expect(said("b := w.nope;")).toContain("'w' is no structured variable")
  expect(said("b := w.c;")).toEqual([])
  expect(said("b := w.3;")).toEqual([])
})
