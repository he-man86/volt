/**
 * call-result-access — C0185: component `.`, index `[]`, or call `()` directly on a function-call result.
 * Fires once per offending access; a clean call and access on a variable stay quiet.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const MSG =
  "It is not possible to perform component access '.', index access '[]' or call '()' on result of function call. Assign result to help variable first."

const msgs = (body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n i:INT; a:ARRAY[0..3] OF INT;\nEND_VAR\n${body}\nEND_PROGRAM\nFUNCTION F : INT\nEND_FUNCTION`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "call-result-access")
    .map((d) => d.message)
}

test("C0185: component/index/call access on a function-call result is flagged", () => {
  expect(msgs(`i := F().x;`)).toEqual([MSG]) // component access
  expect(msgs(`i := F()[0];`)).toEqual([MSG]) // index access
  expect(msgs(`i := F()();`)).toEqual([MSG]) // call
})

test("a plain call and access on a variable are not flagged", () => {
  expect(msgs(`i := F();`)).toEqual([])
  expect(msgs(`i := a[0];`)).toEqual([])
})
