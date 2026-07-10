/**
 * parse-errors mechanism — the statement parser already detects & precisely locates statement-level syntax
 * errors (previously discarded by design D3); `parseStatements(body).errors` now exposes them, ready for
 * `checkParseErrors` to surface once the grammar-completeness gate is green (change `resilient-st-parse-errors`).
 *
 * These assert the MECHANISM (the parser produces the right error at the right token, and stays silent on
 * valid ST) — the check itself is intentionally NOT yet registered in the diagnostics pipeline, because the
 * conformance gate found grammar gaps (partial access, typed char literals) that must be closed first.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { parseStatements } from "../../../syntax/statements.js"
import { unitBodies } from "../../../syntax/bodies.js"

const parseErrors = (src: string): string[] => {
  const pr = parseSource(src)
  const out: string[] = []
  for (const unit of pr.units) for (const body of unitBodies(unit)) out.push(...parseStatements(body).errors.map((e) => e.message))
  return out
}

test("a missing THEN is detected precisely (not swallowed, not a cascade)", () => {
  expect(parseErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest\n  x := 9;\nEND_IF\nEND_PROGRAM`)).toEqual([
    "expected THEN in IF, got identifier 'x'",
  ])
})

test("a missing FOR initializer is detected", () => {
  expect(parseErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nFOR i TO 10 DO\n  ;\nEND_FOR\nEND_PROGRAM`).length).toBeGreaterThan(0)
})

test("valid ST produces NO parse errors (the zero-FP contract the gate enforces)", () => {
  expect(parseErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest THEN\n  x := 9;\nELSE\n  x := 0;\nEND_IF\nEND_PROGRAM`)).toEqual([])
  expect(parseErrors(`FUNCTION_BLOCK FB\nVAR i : INT;\nEND_VAR\nFOR i := 0 TO 10 BY 1 DO\n  i := i;\nEND_FOR\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(parseErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nCASE i OF\n  1: i := 2;\n  2, 3: i := 4;\nELSE\n  i := 0;\nEND_CASE\nEND_PROGRAM`)).toEqual([])
})
