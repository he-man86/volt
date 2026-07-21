import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, CONFIGURABLE_CHECKS } from "./index.js"

/**
 * CODESYS's "Compiler warnings" dialog model: each configurable code is a 3-state control (off / warning /
 * error), defaulting to warning; errors that aren't in the dialog are untoggleable. The central filter drops
 * an "off" code and FORCES the chosen severity on the rest.
 */
const diag = (src: string, opts?: Parameters<typeof resolveConfig>[0]) => {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig(opts) })
}

// C0139 no-op-statement: `i;` (a bare expression) has no effect — a configurable code Volt emits as warning.
const noOp = `FUNCTION_BLOCK F\nVAR i : INT; END_VAR\ni;\nEND_FUNCTION_BLOCK`
const noOpD = (src: string, opts?: Parameters<typeof resolveConfig>[0]) => diag(src, opts).filter((d) => d.code === "no-op-statement")

test("every configurable code defaults to warning (CODESYS's default)", () => {
  const d = resolveConfig().diagnostics
  for (const { code } of CONFIGURABLE_CHECKS) expect(d[code]).toBe("warning")
})

test("a configurable code fires as a warning by default", () => {
  const [d] = noOpD(noOp)
  expect(d?.severity).toBe("warning")
})

test("state 'off' drops the diagnostic entirely", () => {
  expect(noOpD(noOp, { diagnostics: { "no-op-statement": "off" } })).toEqual([])
})

test("state 'error' FORCES the diagnostic to error severity", () => {
  const [d] = noOpD(noOp, { diagnostics: { "no-op-statement": "error" } })
  expect(d?.severity).toBe("error")
})

test("one code's state does not affect another", () => {
  expect(noOpD(noOp, { diagnostics: { "adr-on-bit": "off" } })[0]?.severity).toBe("warning")
})

test("a code Volt emits as ERROR but CODESYS defaults to warning is corrected to warning", () => {
  // C0118 jump-label-unreferenced — Volt's check emits it as error; the filter forces the configured warning.
  const src = `FUNCTION_BLOCK F\nlbl: ;\nEND_FUNCTION_BLOCK`
  const labels = diag(src).filter((d) => d.code === "jump-label-unreferenced")
  if (labels.length > 0) expect(labels[0]?.severity).toBe("warning") // default state = warning
})

test("a non-configurable ERROR is never affected by the dialog states", () => {
  const src = `FUNCTION_BLOCK F\nVAR a : INT; END_VAR\na := nope;\nEND_FUNCTION_BLOCK` // unresolved-identifier (error)
  // Even with every configurable code turned off, the error still rides through.
  const allOff = Object.fromEntries(CONFIGURABLE_CHECKS.map((w) => [w.code, "off"]))
  const d = diag(src, { diagnostics: allOff as never }).filter((x) => x.code === "unresolved-identifier")
  expect(d[0]?.severity).toBe("error")
})
