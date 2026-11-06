/**
 * The wire rules of the plain-ST network check (`_plain-st-wires.ts`), one small made-up network each. The shared case set
 * (`_plain-st.test.ts`) holds the same rules against the bridge's reader.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const ld = (decls: string, body: string) => `PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE LD\n${body}END_PROGRAM\n`
const findings = (src: string) => networkDiags(src).filter((d) => d.code === "network-plain-st").map((d) => d.message)

test("a wire is defined once and read by its name any number of times, before its definition too", () => {
  expect(findings(ld("\ta, b, x, y : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(w1, Q => x);\nw1 := a AND b;\nASSIGN(w1, Q => y);\n"))).toEqual([])
  expect(findings(ld("\ta, b, x : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a;\nw1 := b;\nASSIGN(w1, Q => x);\n"))).toContain("the wire w1 is defined twice")
  expect(findings(ld("\tx : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(TRUE, Q => x);\n"))).toContain("the wire w1 is named and never defined")
  expect(findings(ld("\ta, x : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(a, Q => w1);\nASSIGN(w1, Q => x);\n"))).toContain(
    "the wire w1 as an ASSIGN target: a wire is defined alone, w1 := value",
  )
})

test("an enabled box other than a comparison is read by its value only as a coil's value, through a wire too", () => {
  const ok = ld("\tc : BOOL;\n\ti, j, x, y : INT;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := ADD(EN := c, i, j).OUT;\nASSIGN(w1, Q => x);\nASSIGN(w1, Q => y);\n")
  expect(findings(ok)).toEqual([])
  const inBox = ld("\tc : BOOL;\n\ti, j, x, y : INT;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := ADD(EN := c, i, j).OUT;\nASSIGN(MUL(w1, 2), Q => x);\nASSIGN(w1, Q => y);\n")
  expect(findings(inBox).some((m) => m.includes("comparison operators only"))).toBe(true)
  // with no member a box showing EN hands on its ENO, which any box reads; an enabled comparison's value too
  expect(findings(ld("\tc, x : BOOL;\n\ti, j, k : INT;", "%NETWORK\nASSIGN(AND(c, ADD(EN := c, i, j, OUT => k), GT(EN := c, i, 3).OUT), Q => x);\n"))).toEqual([])
})
