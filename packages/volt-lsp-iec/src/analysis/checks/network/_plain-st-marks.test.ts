/**
 * The marks of a network (`_plain-st-marks.ts`): a mark is a function around a value, held by the receiver it stands at as
 * far as that holds it — the line into a coil a negation outside an edge, a pin or EN one mark — and the rest by the node,
 * a contact or a box; and the retired forms, each refused naming its ASSIGN. The shared case set holds every refusal
 * (`_plain-st.test.ts`); these pin the rules on one small network each.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const fbd = (body: string) => `PROGRAM P\nVAR\n\ta, b, c, x, y : BOOL;\nEND_VAR\n%LANGUAGE FBD\n${body}END_PROGRAM\n`
const findings = (body: string) => networkDiags(fbd(body)).filter((d) => d.code === "network-plain-st").map((d) => d.message)

test("a mark is a function around a value: a contact's, a pin's, EN's, the line into a coil's, stacked as the store holds", () => {
  const ok =
    "%NETWORK\nASSIGN(a AND INVERT(b) AND RISING(INVERT(c)), Q => x);\nASSIGN(AND(INVERT(a), RISING(b)), Q => y);\n" +
    "ASSIGN(INVERT(RISING(RISING(INVERT(a)))), Q => x);\nASSIGN(MOVE(EN := INVERT(RISING(INVERT(a))), b, OUT => c), Q => y);\nASSIGN(INVERT(AND(a, b)), Q => x);\n"
  expect(findings(ok)).toEqual([])
  expect(findings("%NETWORK\nASSIGN(AND(INVERT(INVERT(RISING(a))), b), Q => x);\n")[0]).toContain("a stack of marks deeper than the IDE stores")
  expect(findings("%NETWORK\nASSIGN(INVERT(a AND b) AND c, Q => x);\n")[0]).toContain("a mark is on a contact, a box, or a receiver")
  expect(findings("%NETWORK\nASSIGN(RISING(a, b), Q => x);\n")[0]).toContain("the mark RISING takes one value, positional, and names no output")
})

test("a mark word is no text: refused naming its function, and its statement still read", () => {
  expect(findings("%NETWORK\nASSIGN(a AND NOT b, Q => x);\n")).toEqual([
    "a mark is a function around a value, INVERT(a), RISING(a), FALLING(a); on a receiver it is in the output's name, Q_INVERTED => y. NOT(a) is the NOT box",
  ])
  expect(findings("%NETWORK\nASSIGN(AND(a, NOT b), Q => x);\n")[0]).toContain("a mark before a pin")
  expect(findings("%NETWORK\nASSIGN(AND(a, := b), Q => x);\n")[0]).toContain("an empty pin name with no mark")
})

test("a coil, a jump and the return written as an ST assignment are the retired forms, each naming its ASSIGN", () => {
  expect(findings("%NETWORK\ny := a;\n")[0]).toContain("a coil is ASSIGN(value, Q => y)")
  expect(findings("%NETWORK\ny S= a;\n")[0]).toContain("a set coil is ASSIGN(value, Q_SET => y)")
  expect(findings("%NETWORK\nl:\nJMP.l := a;\n")[0]).toContain("a jump or a return is a target of an ASSIGN")
  expect(findings("%NETWORK\nASSIGN((y := a) AND b, Q => x);\n")[0]).toContain("a coil inside a value is ASSIGN(value, Q => y)")
})

test("ASSIGN takes its value, then its targets Q, Q_SET, Q_RESET, Q_INVERTED; a jump or the return on Q or Q_INVERTED", () => {
  expect(findings("%NETWORK\nl:\nASSIGN(a, Q => x, Q_SET => y, Q_RESET => c, Q_INVERTED => b, Q_INVERTED => JMP.l, Q => RETURN);\n")).toEqual([])
  expect(findings("%NETWORK\nASSIGN(Q => x);\n")[0]).toContain("ASSIGN takes its value, positional, then one target or more")
  expect(findings("%NETWORK\nASSIGN(a, Q_RISING => x);\n")[0]).toContain("its outputs are Q, Q_INVERTED, Q_SET and Q_RESET; an edge is on the value")
  expect(findings("%NETWORK\nASSIGN(a, Q_SET => RETURN);\n")[0]).toContain("a jump or a return is no set or reset coil")
})

test("a name the text spells its own call with, declared in reach, is refused (rule 9)", () => {
  const src = "PROGRAM P\nVAR\n\ta, x, ASSIGN : BOOL;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nx := a;\nEND_PROGRAM\n"
  expect(networkDiags(src).map((d) => d.message)).toContain(
    "a POU or variable named INVERT, RISING, FALLING or ASSIGN is refused: 'ASSIGN' is declared in reach, and the text spells its own call with that name",
  )
})

test("a value standing alone is an item, a box at its root consumed by nothing", () => {
  expect(findings("%NETWORK\na;\nINVERT(b);\nRISING(c);\na AND b;\nBRANCH(FEED := a, b, c);\nRAIL();\nINVERT(AND(a, b));\nTRUE;\n")).toEqual([])
})
