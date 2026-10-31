/**
 * The wire rules of the plain-ST network check (`_plain-st-wires.ts`), one small made-up network each. The shared case set
 * (`_plain-st.test.ts`) holds the same rules against the bridge's reader.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const ld = (decls: string, body: string) => `PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE LD\n${body}END_PROGRAM\n`
const findings = (src: string) => networkDiags(src).filter((d) => d.code === "network-plain-st").map((d) => d.message)

test("a wire is defined once and read by its name any number of times, before its definition too", () => {
  expect(findings(ld("\ta, b, x, y : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nx := w1;\nw1 := a AND b;\ny := w1;\n"))).toEqual([])
  expect(findings(ld("\ta, b, x : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a;\nw1 := b;\nx := w1;\n"))).toContain("the wire w1 is defined twice")
  expect(findings(ld("\tx : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nx := TRUE;\n"))).toContain("the wire w1 is named and never defined")
})

test("an enabled box other than a comparison is read by its value only as a coil's value, through a wire too", () => {
  const ok = ld("\tc : BOOL;\n\ti, j, x, y : INT;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := ADD(EN := c, i, j);\nx := w1;\ny := w1;\n")
  expect(findings(ok)).toEqual([])
  const inBox = ld("\tc : BOOL;\n\ti, j, x, y : INT;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := ADD(EN := c, i, j);\nx := MUL(w1, 2);\ny := w1;\n")
  expect(findings(inBox).some((m) => m.includes("comparison operators only"))).toBe(true)
  expect(findings(ld("\tc, x : BOOL;\n\ti : INT;", "%NETWORK\nx := AND(c, GT(EN := c, i, 3));\n"))).toEqual([])
})
