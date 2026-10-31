/**
 * The lines of a network that are no code (`_plain-st-lines.ts`): a title's and a comment's escapes as the writer writes
 * them, and the wires numbered as the writer numbers them (network-text-one-to-one F14, F16). The shared case set holds
 * every refusal (`_plain-st.test.ts`); these pin the rules on one small network each.
 */
import { expect, test } from "bun:test"
import { networkDiags } from "../../../../test/support/network-docs.js"

const ld = (body: string) => `PROGRAM P\nVAR\n\ta, b, x, y : BOOL;\nEND_VAR\n%LANGUAGE LD\n${body}END_PROGRAM\n`
const findings = (body: string) => networkDiags(ld(body)).filter((d) => d.code === "network-plain-st").map((d) => d.message)

test("a title and a comment line spell only the writer's escapes", () => {
  expect(findings('%NETWORK "a$$b $"c$" $R$L"\n// cost $$5$Lnext\nx := a;\n')).toEqual([])
  expect(findings('%NETWORK ""\nx := a;\n')[0]).toContain("an empty title")
  expect(findings('%NETWORK "a$Nb"\nx := a;\n')[0]).toContain("the escape '$N'")
  expect(findings("%NETWORK\n// a$\"b\nx := a;\n")[0]).toContain("the escape '$\"'")
})

test("wires are w1, w2, … across the body, in the order the text first names them", () => {
  const net = (w: string) => `VAR ${w} : ANY; END_VAR\n${w} := a AND b;\nx := ${w};\ny := ${w};\n`
  expect(findings(`%NETWORK\n${net("w1")}%NETWORK\n${net("w2")}`)).toEqual([])
  expect(findings(`%NETWORK\n${net("w1")}%NETWORK\n${net("w3")}`)[0]).toContain("the wire w3 is the body's w2")
})
