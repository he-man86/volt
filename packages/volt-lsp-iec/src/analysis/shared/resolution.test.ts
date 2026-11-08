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

// `names/scalar-members.ts`, CODESYS 3.5.21.40: a member read through a REFERENCE TO an integer is the integer's; off any
// other elementary value — a REAL, a STRING, a TIME, a BOOL, a DATE, directly or through a REFERENCE TO — it is no
// structured variable AND has no type, whatever the member; a bit number there is also "Biaccess is only possible on
// integer types" (the vendor's spelling).
const value = (decl: string, body: string) =>
  diag(fb(`VAR\n${decl}\n\tout : BOOL;\nEND_VAR\nVAR CONSTANT\n\tc : INT := 0;\nEND_VAR\n${body}`))
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()

test("a REFERENCE TO an integer read with a member nothing declares is the integer's: no structured variable, a BIT", () => {
  expect(value("\tv : INT;\n\tx : REFERENCE TO INT;", "out := x.foo;")).toEqual(["'x' is no structured variable"])
  expect(value("\tv : INT;\n\tx : REFERENCE TO INT;", "out := x.0;")).toEqual([])
  expect(value("\tx : INT;", "x.foo := TRUE;")).toEqual(["'x' is no structured variable"])
})

test.each([["REAL"], ["STRING"], ["TIME"], ["BOOL"], ["DATE"], ["REFERENCE TO REAL"]])("a member read off a %s is no structured variable and has no type", (t) => {
  expect(value(`\tx : ${t};`, "out := x.foo;")).toEqual(["'x' is no structured variable", "Cannot convert type 'Unknown type: 'x.foo'' to type 'BOOL'"].sort())
  expect(value(`\tx : ${t};`, "out := x.c;")).toEqual(["'x' is no structured variable", "Cannot convert type 'Unknown type: 'x.c'' to type 'BOOL'"].sort())
  expect(value(`\tx : ${t};`, "out := x.0;")).toEqual(
    ["'x' is no structured variable", "Biaccess is only possible on integer types", "Cannot convert type 'Unknown type: 'x.0'' to type 'BOOL'"].sort(),
  )
})

test("a member written into a REAL is no structured variable and no valid assignment target", () => {
  expect(value("\tx : REAL;", "x.foo := TRUE;")).toEqual(["'x' is no structured variable", "'x.foo' is no valid assignment target"].sort())
})

test("a bit number past the width is refused through a REFERENCE TO as on the variable", () => {
  expect(value("\tv : WORD;\n\tx : REFERENCE TO WORD;", "out := x.17;")).toEqual(["'17' is no valid bit number for 'x'"])
})
