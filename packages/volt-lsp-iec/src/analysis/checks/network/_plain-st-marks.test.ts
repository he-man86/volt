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
  expect(findings("%NETWORK\nx := AND(a, NOT := b, RISING := c);\nNOT y := a;\n")).toEqual([])
  expect(findings("%NETWORK\nx := AND(a, NOT RISING := b);\n")[0]).toContain("NOT RISING: the IDE negates first")
  expect(findings("%NETWORK\nx := AND(a, := b);\n")[0]).toContain("an empty pin name with no mark")
})

test("a marked coil stands first in its chain", () => {
  expect(findings("%NETWORK\ny := NOT x := a;\n")[0]).toContain("a marked coil inside a chain")
})

test("the assignment item's marks stand last in its chain, right before the value: anywhere else they are refused", () => {
  expect(findings("%NETWORK\ny := NOT := a;\n%NETWORK\ny := x := RISING := a;\n%NETWORK\ny := (x := NOT := a) AND b;\n")).toEqual([])
  const place = "the assignment item's marks stand last in its chain"
  expect(findings("%NETWORK\nNOT := y := a;\n")[0]).toContain(place)
  expect(findings("%NETWORK\ny := NOT := x := a;\n")[0]).toContain(place)
  expect(findings("%NETWORK\ny := AND(a, IN := NOT := b);\n")[0]).toContain(place)
  expect(findings("%NETWORK\ny := NOT RISING := a;\n")[0]).toContain("NOT RISING: the IDE negates first")
  expect(findings("%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := NOT := AND(a, b);\ny := w1;\n")[0]).toContain("a mark on the wire w1")
})

test("a jump and the return take a receiver's marks, first in their chain as a coil's", () => {
  expect(findings("%NETWORK\nl:\nNOT JMP.l := c;\nNOT RETURN := a;\nJMP.l := NOT := b;\n")).toEqual([])
  expect(findings("%NETWORK\nl:\ny := NOT JMP.l := c;\n")[0]).toContain("a marked coil inside a chain")
})

test("NOT and the edges read an Execute box where it stands, by its ENO", () => {
  expect(findings("%NETWORK\ny := NOT EXECUTE(EN := a, 'x := TRUE;').ENO;\nz := RISING(EXECUTE(EN := b, 'x := FALSE;').ENO);\n")).toEqual([])
})

test("a value standing alone is an item, a box at its root consumed by nothing; a bracketed assignment is no value", () => {
  expect(findings("%NETWORK\na;\nNOT b;\nRISING(c);\na AND b;\nBRANCH(FEED := a, b, c);\nRAIL();\nNOT AND(a, b);\nTRUE;\n")).toEqual([])
  expect(findings("%NETWORK\n(y := a);\n")[0]).toContain("an assignment in brackets standing alone")
})
