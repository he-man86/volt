/**
 * array-index-out-of-bounds — a CONSTANT index outside its dimension's `lo..hi`. Wording CONFIRMED against
 * live CODESYS + TwinCAT /build (2026-07-07): both say "The constant index '<i>' is not within the range
 * from '<lo>' to '<hi>'". In-range / variable / unknown-dim indices stay quiet (0-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const oob = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR a : ARRAY[0..2] OF INT; i : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "array-index-out-of-bounds")
    .map((d) => d.message)
}

test("a constant index past the upper bound is flagged, byte-identical to the compiler", () => {
  expect(oob(`a[5] := 1;`)).toEqual(["The constant index '5' is not within the range from '0' to '2'"])
})

test("the message is identical on both vendors (confirmed live)", () => {
  expect(oob(`a[5] := 1;`, "twincat")).toEqual(oob(`a[5] := 1;`, "codesys"))
})

test("an in-range constant index and a variable index stay quiet", () => {
  expect(oob(`a[2] := 1;`)).toEqual([]) // upper bound is valid
  expect(oob(`a[i] := 1;`)).toEqual([]) // non-constant index — not statically checkable
})
