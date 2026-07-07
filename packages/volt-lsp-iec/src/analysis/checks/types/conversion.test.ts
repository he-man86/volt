/**
 * conversion-source-mismatch — a `<SRC>_TO_<DST>(arg)` whose arg can't feed the SRC type. Had only
 * conformance coverage; these pin the accept/reject boundary (arg widens into SRC ⇒ ok) + the skips.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const conv = (src: string): string[] => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "conversion-source-mismatch")
    .map((d) => d.message)
}
const fb = (b: string) => `FUNCTION_BLOCK F\n${b}\nEND_FUNCTION_BLOCK`

test("an arg that can't feed the SRC type is flagged (byte-identical wording)", () => {
  // INT_TO_REAL expects an INT source; a REAL arg can't narrow into INT.
  expect(conv(fb(`VAR r : REAL; x : REAL; END_VAR\nx := INT_TO_REAL(r);`))).toEqual([
    "Cannot convert type 'REAL' to type 'INT'",
  ])
})

test("an arg that WIDENS into the SRC type is accepted", () => {
  expect(conv(fb(`VAR i : INT; x : REAL; END_VAR\nx := INT_TO_REAL(i);`))).toEqual([]) // INT feeds INT
  expect(conv(fb(`VAR b : BYTE; x : REAL; END_VAR\nx := INT_TO_REAL(b);`))).toEqual([]) // BYTE widens into INT
})

test("only a single elementary positional arg is checked — everything else skips", () => {
  // a member/complex arg the check can't type → skip; and `TO_STRING` isn't the `SRC_TO_DST` shape.
  expect(conv(fb(`VAR s : STRING; i : INT; END_VAR\ns := TO_STRING(i);`))).toEqual([])
})
