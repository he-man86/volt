/**
 * ONE BOX, AS THE BRIDGE'S READER HOLDS IT (`_plain-st-box.ts`; the case set in `_plain-st.test.ts` holds the parity with
 * `StNetworkReader`): each rule on a small made-up network.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const PROGRAM_P = "PROGRAM p\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ1 : BOOL;\n\tQ2 : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_PROGRAM\n"
const TIMER = "FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : INT;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"
const BOTH = "FUNCTION_BLOCK FB_S\nVAR_OUTPUT\n\tQ : BOOL;\n\tQ_SET : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n"

const findings = (before: string, decls: string, body: string) =>
  networkDiags(`${before}PROGRAM Main\nVAR\n${decls}\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\n${body}END_PROGRAM\n`)
    .filter((d) => d.code === "network-plain-st")
    .map((d) => d.message)

test("a program box flows on its first output, and is read by another through .NAME", () => {
  expect(findings(PROGRAM_P, "\tx, a : BOOL;", "ASSIGN(p(IN := a), Q => x);\nASSIGN(p(IN := a).Q2, Q => x);\n")).toEqual([])
  expect(findings(PROGRAM_P, "\tx, a : BOOL;", "ASSIGN(p(IN := a).Q1, Q => x);\n")).toEqual([
    "the box p is closed by .Q1, its default output: the default flows on with no member, p(…)",
  ])
})

test("an FB box is the call of its instance, and an FB type called is the box with no instance: both read as the FB", () => {
  const decls = "\tt1 : FB_T;\n\ta, q : BOOL;\n\tn : INT;"
  expect(findings(TIMER, decls, "ASSIGN(t1(IN := a), Q => q);\nASSIGN(t1(IN := a).ET, Q => n);\n")).toEqual([])
  expect(findings(TIMER, decls, "t1(IN := a).Q;\n")).toEqual([
    "the box t1 stands at a root closed by .Q, the first output of t1: a root with no closer is its first output, so it names none",
  ])
  expect(findings(TIMER, "\ta : BOOL;", "FB_T(IN := a);\n")).toEqual([])
})

test("a box showing EN flows on its ENO: its first output read through .NAME, and no member is .ENO", () => {
  const decls = "\tt1 : FB_T;\n\ta, c, q, z : BOOL;"
  expect(findings(TIMER, decls, "ASSIGN(t1(EN := c, IN := a), Q => z);\nASSIGN(t1(EN := c, IN := a).Q, Q => q);\n")).toEqual([])
  expect(findings(TIMER, decls, "ASSIGN(t1(EN := c, IN := a).ENO, Q => z);\n")).toEqual([
    ".ENO is no network text: ENO is the flow of a box showing EN, written as the call alone, t1(EN := …)",
  ])
})

test("an output's name carries its mark, read against the callee's outputs; a box declaring both is refused (rule 9)", () => {
  const decls = "\tt1 : FB_T;\n\ts1 : FB_S;\n\ta, x, k : BOOL;"
  expect(findings(TIMER + BOTH, decls, "t1(IN := a, Q_INVERTED => x);\nt1(IN := a, Q_SET => k);\ns1(Q => x);\n")).toEqual([])
  expect(findings(TIMER + BOTH, decls, "s1(Q_SET => k);\n")).toEqual([
    "Q_SET => on the call s1: an output named like a marked output of the same box is refused, FB_S declares both it and the output it would mark",
  ])
  expect(findings(TIMER, decls, "t1(IN := a, Q_SET => k, Q => x);\n")).toEqual([
    "the call t1 wires Q => twice: the IDE writes no second target. Two targets are one ASSIGN, ASSIGN(t1(…), Q => x, Q => y)",
  ])
})

test("an IEC operator other than the keywords (LIMIT) has one output and no EN of its own: EN := stands first", () => {
  expect(findings("", "\tx, c : BOOL;\n\tv, y : INT;", "LIMIT(EN := c, MN := 0, IN := v, MX := 100, OUT => y);\n")).toEqual([])
  expect(findings("", "\tv, y : INT;", "ASSIGN(LIMIT(0, v, 100).OUT, Q => y);\n")).toEqual([
    "the box LIMIT is closed by .OUT, its default output: the default flows on with no member, LIMIT(…)",
  ])
})
