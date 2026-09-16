/**
 * unknown-source — the IDE's error propagation: what a hole in the types broke. Wording recorded live on CODESYS SP21
 * (conformance `cc_unknown_member`, `deref_on_array_type`, `cc3_multiple_inheritance`, `fbcall_this_in_program`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(src: string, vendor: Vendor = "codesys"): string[] {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unknown-source")
    .map((d) => d.message)
}
const fb = (decls: string, body: string) => `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`

test("an assignment whose source has no type names the hole and the destination", () => {
  expect(msgs(fb("y : INT;", "y := nope;"))).toEqual(["Cannot convert type 'Unknown type: 'nope'' to type 'INT'"])
  expect(msgs(fb("arr : ARRAY[0..1] OF INT; x : INT;", "x := arr^;"))).toEqual([
    "Cannot convert type 'Unknown type: 'arr^'' to type 'INT'",
  ])
})

test("an operator's operand that has no type is named on its own, and the operation is parenthesized", () => {
  // the compiler echoes every binary with parentheses it was not written with (`one + two` → `(one + two)`)
  expect(msgs(fb("one : INT; own : INT;", "own := one + two;"))).toEqual([
    "Cannot convert type 'Unknown type: '(one + two)'' to type 'INT'",
    "Unknown type: 'two'",
  ])
})

test("an inference GAP is not a hole — only a name that does not resolve is", () => {
  // Why this gate exists: reporting on any unknown type produced 30 false positives at once. A mixed-sign operation
  // and an untyped integer literal are types the LSP does not MEET yet; the compiler types both without trouble.
  expect(msgs(fb("si : INT; un : UINT; res : DINT;", "res := si AND un;"))).toEqual([])
  expect(msgs(fb("n : INT;", "n := 1;"))).toEqual([])
  // a wrong index COUNT is not a lost type either (conformance `cc2_indexing_and_arity`)
  expect(msgs(fb("grid : ARRAY[1..2, 1..2] OF INT; taken : INT;", "taken := grid[1];"))).toEqual([])
})

test("TwinCAT is unmeasured, so the check stays silent there", () => {
  expect(msgs(fb("y : INT;", "y := nope;"), "twincat")).toEqual([])
})
