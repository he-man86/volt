/**
 * method-reference (C0130): a method member used as a value without `()` is flagged; a proper call is not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const mr = (body: string): string[] => {
  const src = `FUNCTION_BLOCK FB
END_FUNCTION_BLOCK
METHOD METH1 : INT
METH1 := 1;
END_METHOD
PROGRAM PLC_PRG
VAR f : FB; y : INT; END_VAR
${body}
END_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "method-referenced-without-parens")
    .map((d) => d.message)
}

test("a method referenced as a value without parens is flagged", () => {
  expect(mr(`y := f.METH1;`)).toEqual(["METHOD 'METH1' referenced without parentheses '()'"])
})

test("a proper method call is not flagged", () => {
  expect(mr(`y := f.METH1();`)).toEqual([])
  expect(mr(`f.METH1();`)).toEqual([])
})
