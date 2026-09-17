/**
 * One conversion-name parser (consolidate-lsp-structure A4). There were six, and they disagreed on names spelled with
 * the long type names; CODESYS defines none of those (conformance `cc_conv_spelled_*`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../analysis/index.js"
import { parseConversionName } from "./elementary.js"

const parsed = (name: string) => {
  const c = parseConversionName(name)
  return c === undefined ? undefined : [c.from?.name, c.to.name]
}

test("a conversion name is two elementary types as the table spells them, or TO_ and one", () => {
  expect(parsed("INT_TO_REAL")).toEqual(["INT", "REAL"])
  expect(parsed("tod_to_udint")).toEqual(["TOD", "UDINT"])
  expect(parsed("TO_STRING")).toEqual([undefined, "STRING"])
  // not defined in CODESYS, and not a conversion: the spelled-out names, and a project name of that shape
  expect([parsed("TIME_OF_DAY_TO_UDINT"), parsed("UDINT_TO_TIME_OF_DAY"), parsed("GO_TO_START"), parsed("INT_TO_")]).toEqual([
    undefined, undefined, undefined, undefined,
  ])
})

const diagnostics = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
}

test("a spelled-out conversion name is an undefined identifier, as CODESYS reports it — it resolved silently", () => {
  expect(diagnostics("t : TOD; u : UDINT;", "u := TIME_OF_DAY_TO_UDINT(t);")).toContain("Identifier 'TIME_OF_DAY_TO_UDINT' not defined")
  expect(diagnostics("t : TOD; u : UDINT;", "u := TOD_TO_UDINT(t);")).not.toContain("Identifier 'TOD_TO_UDINT' not defined")
})

test("a conversion's source mismatch prints the types as CODESYS prints them", () => {
  expect(diagnostics("i : INT; u : UDINT;", "u := TOD_TO_UDINT(i);")).toContain("Cannot convert type 'INT' to type 'TIME_OF_DAY'")
})

test("an ANY family spelled WITHOUT its underscore is still a conversion", () => {
  // CODESYS writes `ANYNUM_TO_WORD`; the type group is spelled `ANY_NUM`. Read only as the latter, all 80 corpus
  // uses were undefined identifiers — and the corpus gate could not see it: there the argument is
  // namespace-qualified, and a library-qualified reference is skipped whole (conformance `cs_anynum_to_conversions`).
  expect(parseConversionName("ANYNUM_TO_WORD")?.to.name).toBe("WORD")
  expect(parseConversionName("ANYINT_TO_REAL")?.to.name).toBe("REAL")
  expect(parseConversionName("ANYNUM_TO_WORD")?.from).toBeUndefined() // names no concrete source
  // the underscored spelling keeps working, and a name that is neither is still refused
  expect(parseConversionName("ANY_TO_DWORD")?.to.name).toBe("DWORD")
  expect(parseConversionName("TIME_OF_DAY_TO_UDINT")).toBeUndefined() // CODESYS has no such function
  expect(parseConversionName("NOTATYPE_TO_INT")).toBeUndefined()
})
