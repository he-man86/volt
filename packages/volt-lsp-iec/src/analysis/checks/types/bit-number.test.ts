/**
 * invalid-bit-number (C0003). A dot-bit-access index past the accessed integer/bit-string variable's width.
 * Docs wording (#C0003); provisional until a live recording locks it.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const bits = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  w : WORD; b : BOOL; d : DWORD; re : REAL;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "invalid-bit-number")
    .map((d) => d.message)
}

test("a bit index past the type width names the index and the variable", () => {
  expect(bits(`b := w.17;`)).toEqual(["'17' is not a valid bit number for 'w'"]) // WORD is 16-bit → .16 up is invalid
  expect(bits(`b := d.32;`)).toEqual(["'32' is not a valid bit number for 'd'"]) // DWORD is 32-bit → .0..31
})

test("an in-range bit index stays quiet (0-FP)", () => {
  expect(bits(`b := w.15;`)).toEqual([]) // highest valid WORD bit
  expect(bits(`b := w.0;`)).toEqual([])
})

test("bit access on a non-integer base is a different error, not flagged here", () => {
  expect(bits(`re := re.3;`)).toEqual([]) // REAL — not an integer/bit-string family
})

test("C0061: bit access on a function-call result is flagged (not treated as C0003)", () => {
  const src = `FUNCTION_BLOCK F\nVAR i:INT;\nEND_VAR\ni := Test().2;\nEND_FUNCTION_BLOCK\nFUNCTION Test : INT\nEND_FUNCTION`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "bit-access-on-call")
    .map((d) => d.message)
  expect(msgs).toEqual(["Bitaccess on function call is not allowed"])
})

test("byte-identical on both vendors", () => {
  expect(bits(`b := w.17;`, "twincat")).toEqual(bits(`b := w.17;`, "codesys"))
})
