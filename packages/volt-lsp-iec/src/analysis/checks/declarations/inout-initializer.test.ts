/**
 * inout-initializer — C0441: a VAR_IN_OUT variable referenced in another declaration's initializer. A
 * VAR_IN_OUT used in a statement body (its normal use) is not flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const msgs = (src: string): string[] => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "inout-in-initializer")
    .map((d) => d.message)
}

test("C0441: a VAR_IN_OUT referenced in an initializer is flagged", () => {
  expect(msgs(`FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR_OUTPUT\n b : INT := a;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
})

test("C0441: a VAR_IN_OUT used in the body (not an initializer) is not flagged", () => {
  expect(msgs(`FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n b : INT;\nEND_VAR\nb := a;\nEND_FUNCTION_BLOCK`)).toEqual([])
  // an unrelated initializer referencing a non-VAR_IN_OUT constant is fine
  expect(msgs(`FUNCTION_BLOCK POU\nVAR CONSTANT\n c : INT := 5;\nEND_VAR\nVAR\n b : INT := c;\nEND_VAR\nVAR_IN_OUT\n a : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// analysis-conformance 3.4 (both vendors, recorded 2026-10-06): an AGGREGATE initializer is compiled into the FB's
// FB_INIT too, so a VAR_IN_OUT read inside one is the same uninitialized access (`ioinit_array_initializer`,
// `ioinit_struct_initializer`) — the check skipped aggregates "conservatively", and so missed both
test("C0441: a VAR_IN_OUT read inside an ARRAY or a STRUCT initializer is flagged", () => {
  expect(msgs(`FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n c : ARRAY[0..1] OF INT := [a, 1];\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
  const struct = `TYPE S :\nSTRUCT\n x : INT;\n y : INT;\nEND_STRUCT\nEND_TYPE\n`
  expect(msgs(`${struct}FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n v : S := (x := a);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
  expect(msgs(`${struct}FUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n v : S := (x := 1, y := a);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
  // a field NAMED like the VAR_IN_OUT is the struct's, not the parameter
  expect(msgs(`TYPE S2 :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\nFUNCTION_BLOCK POU\nVAR_IN_OUT\n a : INT;\nEND_VAR\nVAR\n v : S2 := (a := 1);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// …and an FB INSTANCE's initializer naming that FB's own VAR_IN_OUT (`ioinit_fb_instance_literal`, `cc5_fb_init_inout`):
// besides "'target' is no input" (fb-init-inout), both vendors warn the access is to an uninitialized VAR_IN_OUT
test("C0441: an FB instance initialized through the FB's VAR_IN_OUT is flagged", () => {
  const bound = `FUNCTION_BLOCK B\nVAR_INPUT\n amount : INT;\nEND_VAR\nVAR_IN_OUT\n target : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
  expect(msgs(`${bound}FUNCTION_BLOCK POU\nVAR\n w : B := (target := 5);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual(["Access to uninitialized VAR_IN_OUT variable"])
  expect(msgs(`${bound}FUNCTION_BLOCK POU\nVAR\n own : INT;\n w : B := (amount := 1, target := own);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Access to uninitialized VAR_IN_OUT variable",
  ])
  // its INPUT is no VAR_IN_OUT
  expect(msgs(`${bound}FUNCTION_BLOCK POU\nVAR\n w : B := (amount := 1);\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// gate review (3.4+3.6): measured in a FUNCTION_BLOCK's declarations only, as its sibling inout-access `initializerAccess` —
// a PROGRAM's instance initialized through the FB's VAR_IN_OUT is not asked, so neither warning is given there
test("C0441: an FB instance in a PROGRAM initialized through the FB's VAR_IN_OUT is not flagged (unmeasured)", () => {
  const bound = `FUNCTION_BLOCK B\nVAR_IN_OUT\n target : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
  expect(msgs(`${bound}PROGRAM P\nVAR\n x : INT;\n w : B := (target := x);\nEND_VAR\nEND_PROGRAM`)).toEqual([])
})
