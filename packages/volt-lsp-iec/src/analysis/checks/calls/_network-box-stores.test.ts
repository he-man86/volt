/** A network box's own stores, each as CODESYS 3.5.21.40 reports it (conformance `ng_ot_*`). */
import { expect, test } from "bun:test"
import { diagnose } from "../../../../test/support/diagnose.js"

const fb = "FUNCTION_BLOCK FB_P\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR\n%LANGUAGE ST\nQ := IN;\nEND_FUNCTION_BLOCK\n"
const net = (decls: string, code: string) => `${fb}PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE LD\n%NETWORK\n${code}\nEND_PROGRAM\n`
const messages = (src: string) => diagnose(src).map((d) => d.message)

test("an edge's value converts into its BOOL CLK", () => {
  expect(messages(net("\ti : INT;\n\ty : BOOL;", "ASSIGN(RISING(i), Q => y);"))).toContain("Cannot convert type 'INT' to type 'BOOL'")
})

test("an output stored negated is NOT on that output, its operand converted and its value stored", () => {
  const found = messages(net("\ta, y : BOOL;\n\tet : TIME;\n\tt1 : FB_P;", "ASSIGN(t1(IN := a, ET_INVERTED => et), Q => y);"))
  expect(found).toContain("Cannot convert type 'TIME' to type 'UDINT'")
  expect(found).toContain("Cannot convert type 'UDINT' to type 'TIME'")
})

test("a function's value stored through OUT => converts as an assignment does", () => {
  expect(messages(net("\tc, y, b : BOOL;\n\ti : INT;", "ASSIGN(MOVE(EN := c, i, OUT => b), Q => y);"))).toContain("Cannot convert type 'INT' to type 'BOOL'")
})
