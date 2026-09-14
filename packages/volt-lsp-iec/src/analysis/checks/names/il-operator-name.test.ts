/**
 * il-operator-name — an instruction-list operator as a variable name. Wording recorded live on CODESYS SP21 (conformance
 * `cc_reserved_name_r`, `cc_reserved_name_s_upper`, `cc_il_name_*`); TwinCAT unmeasured, so the check is CODESYS-only.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function diagnose(src: string, vendor: Vendor = "codesys") {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
}
const program = (decl: string, body = "") => `PROGRAM PLC_PRG\nVAR\n  ${decl}\nEND_VAR\n${body}\nEND_PROGRAM`
const flagged = (decl: string, vendor: Vendor = "codesys") =>
  diagnose(program(decl), vendor).filter((d) => d.code === "il-operator-name")

test("a variable named r is a CODESYS parse error, echoing the name as written", () => {
  // The lexer reads a bare `r` as an identifier, so the parser accepted this and nothing flagged it.
  const d = flagged("r : INT;")
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("error")
  expect(d[0]?.message).toBe("Unexpected token 'r' found")
  expect(flagged("S : BOOL;")[0]?.message).toBe("Unexpected token 'S' found")
})

test("every recorded IL operator name is reserved the same way — LD, ST, RET, the conditional and negated forms", () => {
  // Found by the execution oracle (`lt`, `ld` would not compile) and recorded one by one (cc_il_name_*); all were silent.
  for (const n of ["ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "calcn", "andn", "orn", "xorn"])
    expect(flagged(`${n} : INT;`).map((d) => d.message)).toEqual([`Unexpected token '${n}' found`])
})

test("`cal` is reported as written and its use is not an undefined identifier", () => {
  // CAL sat in the keyword table: the name was echoed 'CAL', and `cal := 1` added "Identifier 'cal' not defined" —
  // neither is in the recording (cc_il_name_cal), which reports 'cal' on the declaration and on the use.
  const d = diagnose(program("cal : INT;", "cal := 1;"))
  expect(d.map((x) => x.message)).toEqual(["Unexpected token 'cal' found", "Unexpected token 'cal' found"])
})

test("a USE is flagged too — CODESYS reports the declaration and every use", () => {
  // recorded: `s : STRING; s := 'abc';` → "Unexpected token 's' found" twice (cc_reserved_name_s_string)
  const d = diagnose(program("s : STRING;", "s := 'abc';")).filter((x) => x.code === "il-operator-name")
  expect(d.map((x) => x.message)).toEqual(["Unexpected token 's' found", "Unexpected token 's' found"])
})

test("S= and R= stay operators — only a bare NAME is flagged", () => {
  expect(diagnose(program("a : BOOL; b : BOOL;", "a S= b;\na R= b;")).filter((x) => x.code === "il-operator-name")).toEqual([])
})

test("names that merely contain an operator are ordinary identifiers, and CALC is not claimed", () => {
  expect(flagged("rs : INT;")).toEqual([])
  expect(flagged("sValue : INT; ldCount : INT; stop : INT;")).toEqual([])
  // calc parses as a conditional call in CODESYS, with other messages — not modelled, so not flagged
  expect(flagged("calc : INT;")).toEqual([])
})

test("CODESYS-only — TwinCAT is unmeasured, so it stays silent there", () => {
  expect(flagged("r : INT;", "twincat")).toEqual([])
  expect(flagged("ld : INT;", "twincat")).toEqual([])
})
