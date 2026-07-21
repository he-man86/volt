/**
 * pointer-conversion (C0033) — a WARNING when a pointer is implicitly assigned to a non-pointer type. Docs
 * wording.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const pc = (body: string): { message: string; severity: string }[] => {
  const src = `PROGRAM P\nVAR\n ptr:POINTER TO INT; dw:DWORD; p2:POINTER TO INT;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "pointer-not-convertible")
    .map((d) => ({ message: d.message, severity: d.severity }))
}

test("pointer → non-pointer is a warning with the rendered types", () => {
  expect(pc(`dw := ptr;`)).toEqual([
    { message: "Cannot convert type 'POINTER TO INT' to type 'DWORD'", severity: "warning" },
  ])
})

test("pointer → pointer stays quiet", () => {
  expect(pc(`p2 := ptr;`)).toEqual([])
})
