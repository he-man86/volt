/**
 * enum-init (C0124): an enum member initialized with a real value is flagged; integer inits, references to
 * sibling members, and plain enums are not. Provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const ei = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "enum-init-not-convertible")
    .map((d) => d.message)
}

test("a real-valued enum initializer is flagged", () => {
  expect(ei(`TYPE DUT : (A := 1, B := 2.5); END_TYPE`)).toEqual(["Cannot convert type 'LREAL' to type 'DUT'"])
})

test("integer inits, sibling references, and plain enums are not flagged", () => {
  expect(ei(`TYPE E : (A := 1, B := A, C := 10/3); END_TYPE`)).toEqual([])
  expect(ei(`TYPE E : (RED, GREEN, BLUE); END_TYPE`)).toEqual([])
})
