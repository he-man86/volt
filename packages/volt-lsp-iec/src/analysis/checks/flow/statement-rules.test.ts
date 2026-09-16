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

test("CONTINUE outside a loop is reported too, and the compiler names the statement", () => {
  // silent before: only EXIT was checked (conformance `cc2_exit_outside_loop`, which records both).
  const src = `FUNCTION_BLOCK F\nVAR\nn : INT;\nEND_VAR\nn := 1;\nEXIT;\nCONTINUE;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "exit-outside-loop")
    .map((d) => d.message)
  expect(msgs).toEqual(["No enclosing loop of which to exit", "No enclosing loop of which to continue"])
  // inside a loop, both are fine
  const ok = `FUNCTION_BLOCK F\nVAR\ni : INT;\nEND_VAR\nFOR i := 1 TO 3 DO\nCONTINUE;\nEXIT;\nEND_FOR\nEND_FUNCTION_BLOCK`
  const okParse = parseSource(ok)
  expect(
    computeSemanticDiagnostics({
      parseResult: okParse,
      source: ok,
      project: buildSymbolTable([{ uri: "F.fb", parseResult: okParse, source: ok }]),
      config: resolveConfig({ vendor: "codesys" }),
    }).filter((d) => d.code === "exit-outside-loop"),
  ).toEqual([])
})
