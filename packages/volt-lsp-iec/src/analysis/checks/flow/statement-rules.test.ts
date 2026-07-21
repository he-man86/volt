/**
 * statement-rules: C0018 (assign to a VAR CONSTANT) + C0132 (EXIT outside a loop).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const run =
  (code: string) =>
  (body: string): string[] => {
    const src = `PROGRAM P\nVAR i:INT; ii:INT;\nEND_VAR\nVAR CONSTANT j:INT:=0;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src)
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const assign = run("not-assignment-target")
const exit = run("exit-outside-loop")

test("C0018: writing to a VAR CONSTANT is flagged; reading it is fine", () => {
  expect(assign(`j := i;`)).toEqual(["'j' is no valid assignment target"])
  expect(assign(`i := j;`)).toEqual([])
})

test("C0132: EXIT outside a loop is flagged; EXIT nested inside a loop is not", () => {
  expect(exit(`EXIT;`)).toEqual(["No enclosing loop of which to exit"])
  expect(exit(`FOR ii:=0 TO 2 DO\n IF i>0 THEN EXIT; END_IF\nEND_FOR`)).toEqual([]) // loop context propagates into IF
})

test("C0509: __NEW in a chained assignment is flagged; a single __NEW is not", () => {
  const src = (b: string) => `FUNCTION_BLOCK F\nVAR pa:POINTER TO BYTE; pb:POINTER TO BYTE;\nEND_VAR\n${b}\nEND_FUNCTION_BLOCK`
  const nw = (b: string) => {
    const pr = parseSource(src(b))
    const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src(b) }])
    return computeSemanticDiagnostics({ parseResult: pr, source: src(b), project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "multiple-assignment-new")
      .map((d) => d.message)
  }
  expect(nw(`pb := pa := __NEW(BYTE);`)).toEqual(["Multiple assignments are not allowed for operator '__New'."])
  expect(nw(`pa := __NEW(BYTE);`)).toEqual([])
})
