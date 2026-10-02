/**
 * What the analysis REPORTS about a conversion name — the rule itself (one parser, `parseConversionName`) is the type
 * layer's and is tested beside it (`types/conversion-name.test.ts`); this half needs the checks (openspec
 * frontend-conformance 1.5: a front-end test imports no consumer).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../frontend/syntax/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "./index.js"
import { build } from "../frontend/symbols/index.js"

const diagnostics = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
}

test("a spelled-out conversion name is an undefined identifier, as CODESYS reports it — it resolved silently", () => {
  expect(diagnostics("t : TOD; u : UDINT;", "u := TIME_OF_DAY_TO_UDINT(t);")).toContain("Identifier 'TIME_OF_DAY_TO_UDINT' not defined")
  expect(diagnostics("t : TOD; u : UDINT;", "u := TOD_TO_UDINT(t);")).not.toContain("Identifier 'TOD_TO_UDINT' not defined")
})

test("a conversion's source mismatch prints the types as CODESYS prints them", () => {
  expect(diagnostics("i : INT; u : UDINT;", "u := TOD_TO_UDINT(i);")).toContain("Cannot convert type 'INT' to type 'TIME_OF_DAY'")
})
