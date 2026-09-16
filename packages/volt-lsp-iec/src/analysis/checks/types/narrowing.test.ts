/**
 * narrowing / sign-change on a DECLARATION's initializer, and how often the compiler reports it (see
 * `pushForDeclaration`). The conversion relation itself is covered by `implicit-conversion.test.ts`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"


test("a VAR CONSTANT initializer warns ONCE in an FB, where a plain VAR warns twice", () => {
  // A constant is folded at compile time, not stored on the instance, so there is no instance initialisation to
  // check it a second time (conformance `co_any_to_conversions` — one warning — against `ir_initializer_warning_*`).
  const run = (section: string) => {
    const src = `FUNCTION_BLOCK F\n${section}\ncLimit : DINT := 16#80000000;\nEND_VAR\nEND_FUNCTION_BLOCK`
    const parseResult = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "sign-change-conversion")
      .map((d) => d.message)
  }
  expect(run("VAR CONSTANT")).toHaveLength(1)
  expect(run("VAR")).toHaveLength(2)
})
