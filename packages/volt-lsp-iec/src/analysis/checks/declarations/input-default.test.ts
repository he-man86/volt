/**
 * input-default — C0525: an array-typed VAR_INPUT parameter with a default value. A scalar input default and an
 * array LOCAL variable default stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "input-default-composite")
    .map((d) => d.message)
}

test("C0525: an array VAR_INPUT default is flagged with its source-text type name", () => {
  expect(msgs(`FUNCTION F : INT\nVAR_INPUT\n a : ARRAY [0..1] OF INT := [1, 2];\nEND_VAR\nF := 0;\nEND_FUNCTION`)).toEqual([
    "The type ARRAY [0..1] OF INT cannot have a default value in this context",
  ])
})

test("a scalar input default and an array LOCAL default are not flagged", () => {
  expect(msgs(`FUNCTION F : INT\nVAR_INPUT\n i : INT := 5;\nEND_VAR\nF := 0;\nEND_FUNCTION`)).toEqual([])
  expect(msgs(`FUNCTION F : INT\nVAR\n a : ARRAY [0..1] OF INT := [1, 2];\nEND_VAR\nF := 0;\nEND_FUNCTION`)).toEqual([])
})
