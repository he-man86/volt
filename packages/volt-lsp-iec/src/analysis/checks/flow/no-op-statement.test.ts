/**
 * no-op-statement (C0139) — a WARNING for an expression statement with no side effect.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const noop = (body: string): string[] => {
  const src = `PROGRAM P\nVAR i:INT; inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement")
    .map((d) => d.message)
}

test("a bare reference statement is warned; a call is not", () => {
  expect(noop(`i;`)).toEqual(["The code 'i;' has no effect. Is this the intent?"])
  expect(noop(`inst();`)).toEqual([]) // a call has effect
})

test("an unresolved bare name is NOT a no-op (gibberish / stripped {IF} branch — the IDE doesn't warn)", () => {
  // Mirrors the conditional-compilation conformance fixtures: code inside a non-taken {IF defined(…)} branch
  // is stripped by the IDE and never compiled, so it must not surface a 'no effect' warning.
  expect(noop(`broken_first_branch_xyz;`)).toEqual([])
})
