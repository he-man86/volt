/**
 * new-in-expression — C0454: a `__NEW` assignment-expression embedded in another expression. A bare `__NEW`
 * allocation statement is fine.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const MSG =
  "It is not possible to use an assignment expression with the __NEW operator in another expression. Use the pointer variable instead."

const msgs = (body: string): string[] => {
  const src = `TYPE ST : STRUCT\n x:INT;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR\n p : POINTER TO ST;\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "new-in-expression")
    .map((d) => d.message)
}

test("C0454: a __NEW assignment-expression in a condition is flagged; a bare __NEW statement is not", () => {
  expect(msgs(`IF (p := __NEW(ST)) = 0 THEN\n RETURN;\nEND_IF`)).toEqual([MSG])
  expect(msgs(`p := __NEW(ST);`)).toEqual([])
})
