/**
 * conversion-source-mismatch — a `<SRC>_TO_<DST>(arg)` whose arg can't feed the SRC type. Had only
 * conformance coverage; these pin the accept/reject boundary (arg widens into SRC ⇒ ok) + the skips.
 */
import { test, expect, describe } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const conv = (src: string): string[] => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "conversion-source-mismatch")
    .map((d) => d.message)
}
const fb = (b: string) => `FUNCTION_BLOCK F\n${b}\nEND_FUNCTION_BLOCK`

test("an arg that can't feed the SRC type is flagged (byte-identical wording)", () => {
  // INT_TO_REAL expects an INT source; a REAL arg can't narrow into INT.
  expect(conv(fb(`VAR rv : REAL; x : REAL; END_VAR\nx := INT_TO_REAL(rv);`))).toEqual([
    "Cannot convert type 'REAL' to type 'INT'",
  ])
})

test("an arg that WIDENS into the SRC type is accepted", () => {
  expect(conv(fb(`VAR i : INT; x : REAL; END_VAR\nx := INT_TO_REAL(i);`))).toEqual([]) // INT feeds INT
  expect(conv(fb(`VAR b : BYTE; x : REAL; END_VAR\nx := INT_TO_REAL(b);`))).toEqual([]) // BYTE widens into INT
})

test("only a single elementary positional arg is checked — everything else skips", () => {
  // a member/complex arg the check can't type → skip; and `TO_STRING` isn't the `SRC_TO_DST` shape.
  expect(conv(fb(`VAR sv : STRING; i : INT; END_VAR\nsv := TO_STRING(i);`))).toEqual([])
})

/**
 * What the analysis REPORTS about a conversion name — the rule itself (one parser, `parseConversionName`) is the type
 * layer's and is tested beside it (`types/conversion-name.test.ts`); this half needs the checks (openspec
 * frontend-conformance 1.5: a front-end test imports no consumer).
 */
describe("what the analysis reports about a conversion name", () => {
  const diagnostics = (vars: string, body: string): string[] => {
    const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
  }

  test("a spelled-out conversion name is an undefined identifier, as CODESYS reports it — it resolved silently", () => {
    expect(diagnostics("t : TOD; u : UDINT;", "u := TIME_OF_DAY_TO_UDINT(t);")).toContain("Identifier 'TIME_OF_DAY_TO_UDINT' not defined")
    expect(diagnostics("t : TOD; u : UDINT;", "u := TOD_TO_UDINT(t);")).not.toContain("Identifier 'TOD_TO_UDINT' not defined")
  })

  test("a conversion's source mismatch prints the types as CODESYS prints them", () => {
    expect(diagnostics("i : INT; u : UDINT;", "u := TOD_TO_UDINT(i);")).toContain("Cannot convert type 'INT' to type 'TIME_OF_DAY'")
  })
})
