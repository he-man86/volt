/**
 * The marks of a network (`_plain-st-marks.ts`): the value mark NOT, and the marks before a receiver in the IDE's order —
 * a pin's, an unnamed pin's before its empty name, a coil's first in its chain. The shared case set holds every refusal
 * (`_plain-st.test.ts`); these pin the rules on one small network each.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const fbd = (body: string) => `PROGRAM P\nVAR\n\ta, b, c, x, y : BOOL;\nEND_VAR\n%LANGUAGE FBD\n${body}END_PROGRAM\n`
const findings = (body: string) => networkDiags(fbd(body)).filter((d) => d.code === "network-plain-st").map((d) => d.message)

test("a mark stands before its receiver, an unnamed pin's before the empty name, the edge outside the negation", () => {
  expect(findings("%NETWORK\nx := AND(a, NOT := b, RISING NOT := c);\nNOT y := a;\n")).toEqual([])
  expect(findings("%NETWORK\nx := AND(a, NOT RISING := b);\n")[0]).toContain("NOT RISING: the IDE negates first")
  expect(findings("%NETWORK\nx := AND(a, := b);\n")[0]).toContain("an empty pin name with no mark")
})

test("a marked coil stands first in its chain", () => {
  expect(findings("%NETWORK\ny := NOT x := a;\n")[0]).toContain("a marked coil inside a chain")
})
