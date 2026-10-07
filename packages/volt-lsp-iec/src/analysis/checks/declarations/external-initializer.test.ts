/**
 * external-initializer — C0238: a VAR_EXTERNAL declaration with an inline initializer. A VAR_EXTERNAL without
 * one (the normal form) stays quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "external-initializer")
    .map((d) => d.message)
}

test("C0238: a VAR_EXTERNAL with an initializer is flagged; without one is fine", () => {
  expect(msgs(`PROGRAM P\nVAR_EXTERNAL\n ig : INT := 2;\nEND_VAR\nEND_PROGRAM`)).toEqual([
    "No initial value allowed for VAR_EXTERNAL ig",
  ])
  expect(msgs(`PROGRAM P\nVAR_EXTERNAL\n ig : INT;\nEND_VAR\nEND_PROGRAM`)).toEqual([])
})
