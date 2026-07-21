/**
 * recursive-call (C0224): a FUNCTION that calls itself is flagged; a return-value assignment and a call to a
 * different function are not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const rc = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "call-recursion")
    .map((d) => d.message)
}

test("a self-calling FUNCTION is flagged", () => {
  expect(rc(`FUNCTION Fib : INT\nVAR_INPUT n : INT; END_VAR\nFib := Fib(n - 1);\nEND_FUNCTION`)).toEqual([
    "Call Recursion: Fib -> Fib",
  ])
})

test("a return-value assignment (no call) and a call to a different function are not flagged", () => {
  expect(rc(`FUNCTION F : INT\nF := 5;\nEND_FUNCTION`)).toEqual([])
  expect(rc(`FUNCTION F : INT\nVAR x : INT; END_VAR\nx := G();\nEND_FUNCTION\nFUNCTION G : INT\nG := 1;\nEND_FUNCTION`)).toEqual([])
})
