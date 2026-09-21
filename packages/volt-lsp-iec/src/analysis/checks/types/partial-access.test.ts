/**
 * partial-access — `d.%W0` is a CODESYS extension and TwinCAT reads the `%` as a component name. Measured on both
 * live IDEs 2026-09-21 at all four widths (`accepts_partial_access`, `operand_partial_*`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(src: string, vendor: Vendor): string[] {
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "partial-access")
    .map((d) => d.message)
}
const fb = (body: string) =>
  `FUNCTION_BLOCK F\nVAR\n\tdwSource : DWORD := 16#DEADBEEF;\n\tlwSource : LWORD;\n\tout : DWORD;\n\tflag : BOOL;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`

test("all four widths, and the same three messages for each", () => {
  for (const [spec, target] of [
    ["%X3", "flag"],
    ["%B3", "out"],
    ["%W1", "out"],
  ] as const)
    expect(msgs(fb(`${target} := dwSource.${spec};`), "twincat")).toEqual([
      "'%' is no component of 'dwSource'",
      `';' expected instead of '${spec.slice(1)}'`,
      `The code '${spec.slice(1)};\n' has no effect. Is this the intent?`,
    ])
  expect(msgs(fb("out := lwSource.%D1;"), "twincat")[0]).toBe("'%' is no component of 'lwSource'")
})

test("CODESYS has the form, so it says nothing about it", () => {
  for (const spec of ["%X3", "%B3", "%W1"]) expect(msgs(fb(`out := dwSource.${spec};`), "codesys")).toEqual([])
})

// NOT `notAMember('%', base)`. That message names a TYPE and upper-cases it on TwinCAT; this one names the
// VARIABLE and leaves it exactly as written, which is the whole reason it is its own entry in `messages.ts`.
test("the base is quoted as written, not upper-cased", () => {
  expect(msgs(fb("flag := dwSource.%X0;"), "twincat")[0]).toBe("'%' is no component of 'dwSource'")
})

test("an ordinary member access is not this", () => {
  const src = `TYPE T : STRUCT\n\tw : WORD;\nEND_STRUCT\nEND_TYPE\nFUNCTION_BLOCK F\nVAR\n\ts : T;\n\tout : WORD;\nEND_VAR\nout := s.w;\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "twincat")).toEqual([])
})
