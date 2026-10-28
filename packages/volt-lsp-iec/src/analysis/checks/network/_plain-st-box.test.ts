/**
 * ONE BOX, AS THE BRIDGE'S READER HOLDS IT (`_plain-st-box.ts`; the case set in `_plain-st.test.ts` holds the parity with
 * `StNetworkReader`): each rule on a small made-up network.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const PROGRAM_P = "PROGRAM p\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ1 : BOOL;\n\tQ2 : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_PROGRAM\n"
const TIMER = "FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : INT;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"

const findings = (before: string, decls: string, body: string) =>
  networkDiags(`${before}PROGRAM Main\nVAR\n${decls}\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\n${body}END_PROGRAM\n`)
    .filter((d) => d.code === "network-plain-st")
    .map((d) => d.message)

test("a program box is read by its VAR_OUTPUTs as a function by its outputs: .NAME where it has several", () => {
  expect(findings(PROGRAM_P, "\tx, a : BOOL;", "x := p(IN := a).Q2;\n")).toEqual([])
  expect(findings(PROGRAM_P, "\tx, a : BOOL;", "x := p(IN := a);\n")).toEqual([
    "the box p is read and names no output: p has 2 (Q1, Q2), so its call is closed by the one its consumer reads, .Q1",
  ])
})

test("FB := stands only on an FB box: not on an operator's call, nor naming a variable that is no FB instance", () => {
  expect(findings("", "\tx : BOOL;\n\ta, b, y : INT;", "ADD(FB := x, a, b, OUT => y);\n")).toContain(
    "FB := on a call of ADD, which is no function block: FB := names an FB box's instance",
  )
  expect(findings(TIMER, "\tx, a : BOOL;", "FB_T(FB := x, IN := a);\n")).toEqual(["the FB box FB_T names x as its instance: x is no FB instance"])
  expect(findings(TIMER, "\tt1 : FB_T;\n\ta, q : BOOL;", "q := FB_T(FB := t1, IN := a).Q;\n")).toEqual([])
})

test("an IEC operator other than the keywords (LIMIT) has one output and no EN of its own: EN := stands first", () => {
  expect(findings("", "\tx, c : BOOL;\n\tv, y : INT;", "LIMIT(EN := c, MN := 0, IN := v, MX := 100, OUT => y).ENO;\n")).toEqual([])
  expect(findings("", "\tv, y : INT;", "y := LIMIT(0, v, 100).OUT;\n")).toEqual([
    "the box LIMIT is closed by .OUT, the one output LIMIT has: a box with one output names none",
  ])
})
