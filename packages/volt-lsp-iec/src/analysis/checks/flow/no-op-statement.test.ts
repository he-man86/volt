/**
 * no-op-statement (C0139) — a WARNING for an expression statement with no side effect.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const noop = (body: string): string[] => {
  const src = `PROGRAM P\nVAR i:INT; inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement")
    .map((d) => d.message)
}

test("a bare reference statement is warned; a call is not", () => {
  expect(noop(`i;`)).toEqual(["The code 'i;\n' has no effect. Is this the intent?"])
  expect(noop(`inst();`)).toEqual([]) // a call has effect
})

test("an unresolved bare name is NOT a no-op (gibberish / stripped {IF} branch — the IDE doesn't warn)", () => {
  // Mirrors the conditional-compilation conformance fixtures: code inside a non-taken {IF defined(…)} branch
  // is stripped by the IDE and never compiled, so it must not surface a 'no effect' warning.
  expect(noop(`broken_first_branch_xyz;`)).toEqual([])
})

test("a statement RESUMED after a refused token is a no-op even when its name is declared nowhere (cc_time_*, lit_*)", () => {
  // `cc_time_nanosecond_literal`, `lit_bool_typed_true`: the compiler never resolves names in a body it could not parse,
  // yet warns "The code 'NS;' has no effect" — the parser marks the statement it resumed at (`ExprStatement.resumed`)
  expect(noop(`i := T#5NS;`)).toEqual(["The code 'NS;\n' has no effect. Is this the intent?"])
  expect(noop(`i := BOOL#TRUE;`)).toEqual(["The code 'RUE;\n' has no effect. Is this the intent?"])
})
