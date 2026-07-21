/**
 * pointer-conversion (C0033) — a WARNING when a pointer is implicitly assigned to a non-pointer type. Docs
 * wording.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const pc = (body: string, vendor: "codesys" | "twincat" = "codesys"): { message: string; severity: string }[] => {
  const src = `PROGRAM P\nVAR\n ptr:POINTER TO INT; dw:DWORD; i:INT; p2:POINTER TO INT;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
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

test("TwinCAT: a pointer-sized target (DWORD) is accepted; a too-small one (INT) still warns", () => {
  expect(pc(`dw := ptr;`, "twincat")).toEqual([]) // DWORD holds a pointer — TC is silent (verified live)
  expect(pc(`i := ptr;`, "twincat")).toEqual([
    { message: "Cannot convert type 'POINTER TO INT' to type 'INT'", severity: "warning" },
  ])
})
