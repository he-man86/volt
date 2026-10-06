/**
 * generic-instantiation — a VAR_GENERIC CONSTANT function block is instanced with one value per generic constant,
 * `inst : FB_G<6>;`. Wording measured on CODESYS SP21 (conformance `decl_var_generic_no_argument`, 2026-10-01).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const FB = `FUNCTION_BLOCK FB_G\nVAR_GENERIC CONSTANT\n\tN : UDINT := 4;\nEND_VAR\nVAR\n\ta : ARRAY[0..N] OF INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`

const errors = (decl: string): string[] => {
  const src = `${FB}\nPROGRAM P\nVAR\n\t${decl}\nEND_VAR\nEND_PROGRAM\n`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
}

test("an instance without its generic value is refused; one with it builds (D5)", () => {
  expect(errors("inst : FB_G;")).toEqual(["Generic Functionblock 'FB_G' expects exactly '1' number of Generic Constant Definitions"])
  expect(errors("inst : FB_G<6>;")).toEqual([])
  // `decl_var_generic_two_values`: two values against one constant, the same message
  expect(errors("inst : FB_G<6, 7>;")).toEqual(["Generic Functionblock 'FB_G' expects exactly '1' number of Generic Constant Definitions"])
})

// A value list the parser refused (`NamedType.genericRefused`) was not read: its count is no fact, so none is reported
// against it — the parse error stands on it alone.
test("a refused value list is not counted", () => {
  for (const decl of ["inst : FB_G<5 6>;", "inst : FB_G<1, +>;"])
    expect(errors(decl).filter((m) => m.startsWith("Generic Functionblock"))).toEqual([])
})

// `decl_var_generic_in_array_no_argument`, `_two_values` (CODESYS 2026-10-01): an ARRAY's element is an instance too,
// counted the same way; `decl_var_generic_in_array` with its one value builds.
test("an ARRAY OF a generic FB counts its element's values the same way", () => {
  const count = ["Generic Functionblock 'FB_G' expects exactly '1' number of Generic Constant Definitions"]
  expect(errors("inst : ARRAY[0..1] OF FB_G;")).toEqual(count)
  expect(errors("inst : ARRAY[0..1] OF FB_G<6, 7>;")).toEqual(count)
  expect(errors("inst : ARRAY[0..1] OF FB_G<6>;")).toEqual([])
})
