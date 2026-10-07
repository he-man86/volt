/**
 * recursive-call: a FUNCTION that calls itself is flagged; a return-value assignment and a call to a different
 * function are not. CODESYS does not phrase it as recursion — it refuses the NAME at the call site (conformance
 * `cc2_call_recursion`); "Call Recursion: F -> F" came from the documentation catalog and no build ever emits it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const rc = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "call-recursion")
    .map((d) => d.message)
}

test("a self-calling FUNCTION is flagged", () => {
  expect(rc(`FUNCTION Fib : INT\nVAR_INPUT n : INT; END_VAR\nFib := Fib(n - 1);\nEND_FUNCTION`)).toEqual([
    "Program name, function or function block instance expected instead of 'Fib'",
  ])
})

test("a return-value assignment (no call) and a call to a different function are not flagged", () => {
  expect(rc(`FUNCTION F : INT\nF := 5;\nEND_FUNCTION`)).toEqual([])
  expect(rc(`FUNCTION F : INT\nVAR x : INT; END_VAR\nx := G();\nEND_FUNCTION\nFUNCTION G : INT\nG := 1;\nEND_FUNCTION`)).toEqual([])
})

// analysis-conformance 3.8 (`calls_method_recursive`, both vendors 2026-10-06): a METHOD calling itself is refused alike
test("a self-calling METHOD is flagged as a FUNCTION is", () => {
  expect(rc(`FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_INPUT n : INT; END_VAR\nM := M(n := n - 1) + 1;\nEND_METHOD`)).toEqual([
    "Program name, function or function block instance expected instead of 'M'",
  ])
})
