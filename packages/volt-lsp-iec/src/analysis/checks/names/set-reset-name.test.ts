/**
 * set-reset-name — `R`/`S` as a variable name. Wording recorded live on CODESYS SP21 (conformance
 * `cc_reserved_name_r`, `cc_reserved_name_s_upper`); TwinCAT unmeasured, so the check is CODESYS-only.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function sr(decl: string, vendor: Vendor = "codesys") {
  const src = `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) }).filter((d) => d.code === "set-reset-name")
}

test("a variable named r is a CODESYS parse error, echoing the name as written", () => {
  // The lexer reads a bare `r` as an identifier, so the parser accepted this and nothing flagged it.
  const d = sr("r : INT;")
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("error")
  expect(d[0]?.message).toBe("Unexpected token 'r' found")
  expect(sr("S : BOOL;")[0]?.message).toBe("Unexpected token 'S' found")
})

test("a USE of r or s is flagged too — CODESYS reports the declaration and every use", () => {
  // recorded: `s : STRING; s := 'abc';` → "Unexpected token 's' found" twice (cc_reserved_name_s_string)
  const src = `PROGRAM PLC_PRG\nVAR\n  s : STRING;\nEND_VAR\ns := 'abc';\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  const d = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter((x) => x.code === "set-reset-name")
  expect(d.map((x) => x.message)).toEqual(["Unexpected token 's' found", "Unexpected token 's' found"])
})

test("S= and R= stay operators — only a bare r/s NAME is flagged", () => {
  expect(sr("a : BOOL; b : BOOL;")).toEqual([])
  const src = `PROGRAM PLC_PRG\nVAR\n  a : BOOL; b : BOOL;\nEND_VAR\na S= b;\na R= b;\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  expect(computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter((x) => x.code === "set-reset-name")).toEqual([])
})

test("names that merely start with r or s are ordinary identifiers", () => {
  expect(sr("rs : INT;")).toEqual([])
  expect(sr("sValue : INT; rCount : INT;")).toEqual([])
})

test("CODESYS-only — TwinCAT is unmeasured, so it stays silent there", () => {
  expect(sr("r : INT;", "twincat")).toEqual([])
})
