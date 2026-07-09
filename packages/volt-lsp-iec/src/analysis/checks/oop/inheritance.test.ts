/**
 * inheritance — C0091 (self-cycle), C0090 (unknown base class), C0086 (unknown interface). Provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const codes = (src: string): { code: string; message: string }[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map(
    (d) => ({ code: d.code, message: d.message }),
  )
}
const msgs = (src: string, code: string) => codes(src).filter((d) => d.code === code).map((d) => d.message)

test("C0091: an FB extending itself is flagged (cycle, not not-found)", () => {
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB\nEND_FUNCTION_BLOCK`, "circular-inheritance")).toEqual([
    "Recursion in base function block list: FB -> FB",
  ])
  expect(codes(`FUNCTION_BLOCK FB EXTENDS FB\nEND_FUNCTION_BLOCK`).some((d) => d.code === "base-class-not-found")).toBe(false)
})

test("C0090: an EXTENDS base that resolves nowhere is flagged; a resolved base is not", () => {
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS UnknownBase\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([
    "No definition found for base class 'UnknownBase'",
  ])
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([])
})

test("C0086: an IMPLEMENTS interface that resolves nowhere is flagged; a resolved one is not", () => {
  const src = `INTERFACE I\nEND_INTERFACE\nFUNCTION_BLOCK FB IMPLEMENTS I, IMissing\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "interface-not-found")).toEqual(["No definition found for interface 'IMissing'"])
})
