/**
 * type-as-value (C0230) — a DUT type name used as an assignment value/target.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const tv = (body: string): string[] => {
  const src = `PROGRAM P\nVAR value : INT;\nEND_VAR\n${body}\nEND_PROGRAM\nTYPE MyEnum : (RED, GREEN); END_TYPE`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "type-name-as-value")
    .map((d) => d.message)
}

test("a type name as an assignment value/target is flagged; member access and SIZEOF are not", () => {
  expect(tv(`value := MyEnum;`)).toEqual(["Type name 'MyEnum' not expected in this place"])
  expect(tv(`MyEnum := value;`)).toEqual(["Type name 'MyEnum' not expected in this place"])
  expect(tv(`value := MyEnum.RED;`)).toEqual([]) // member access
  expect(tv(`value := SIZEOF(MyEnum);`)).toEqual([]) // type as a SIZEOF argument
})
