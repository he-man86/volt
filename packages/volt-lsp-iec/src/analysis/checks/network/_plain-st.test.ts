/**
 * THE PLAIN-ST CASE SET, ON THE EDITOR'S SIDE (openspec network-text-st 2.3, design.md oracle 2): every case of
 * `packages/volt-cli/test/fixtures/network-text-st` — the files the bridge's `StNetworkCaseTests` reads. An accept case
 * is a plain-ST network body the network check says nothing about; a refuse case is refused by it, with its phrase — so
 * the LSP refuses while typing what the bridge's reader refuses, and a case the two judge differently fails both suites.
 * Then the check's rules one by one, each on a small made-up network.
 */
import { expect, test } from "bun:test"
import { isPlainStNetworkBody, parseSource, unitBodies } from "../../../frontend/syntax/index.js"
import { caseRoot, readCases, type Case } from "../../../../test/support/network-cases.js"
import { vgDiags } from "../../../../test/support/network-docs.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const CASES = readCases(caseRoot("network-text-st"))

/** The case's body as a PROGRAM's, its scope's names and instances declared. */
function programOf(c: Case): string {
  const decls = c.scope.flatMap((line) => {
    const w = line.split(/\s+/)
    if (w[0] === "instance" && w.length === 3) return [`\t${w[1]!.replace(/\[\]$/, "")} : ${w[2]};`]
    if (w[0] === "name") return w.slice(1).map((n) => `\t${n} : BOOL;`)
    return []
  })
  // a `pou` line is a function the body can call (declaring its own EN, as the 55 library POUs that do, 1c)
  const pous = c.scope.flatMap((line) => {
    const w = line.split(/\s+/)
    return w[0] === "pou" && w.length === 2 ? [`FUNCTION ${w[1]} : BOOL\nVAR_INPUT\n\tEN : BOOL;\nEND_VAR\n%LANGUAGE ST\n${w[1]} := EN;\nEND_FUNCTION\n`] : []
  })
  return `${pous.join("")}PROGRAM CaseProgram\nVAR\n\tvolt_case_unused : BOOL;\n${decls.join("\n")}\nEND_VAR\n${c.text}END_PROGRAM\n`
}

const findings = (src: string) => vgDiags(src).filter((d) => d.code === "network-plain-st")

test("the case set is there: every v2 accept case as a pull writes it, and a refusal per rule", () => {
  expect(CASES.filter((c) => c.accept).length).toBeGreaterThanOrEqual(100)
  expect(CASES.filter((c) => !c.accept).length).toBeGreaterThanOrEqual(25)
})

for (const c of CASES.filter((x) => x.accept))
  test(`accept ${c.file}/${c.name}: read by the ST parser, nothing the network check refuses`, () => {
    const src = programOf(c)
    if (c.text.split("\n")[1]?.startsWith("%NETWORK"))
      expect(unitBodies(parseSource(src, { networkText: true }, "codesys").units.at(-1)!).some(isPlainStNetworkBody)).toBe(true)
    expect(findings(src).map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}'`)).toEqual([])
  })

for (const c of CASES.filter((x) => !x.accept))
  test(`refuse ${c.file}/${c.name}: ${c.code} '${c.phrase}'`, () => {
    const all = vgDiags(programOf(c))
    const hit = all.some((d) => d.code === c.code && (c.phrase === undefined || d.message.toLowerCase().includes(c.phrase.toLowerCase())))
    expect(hit ? "refused as stated" : all.map((d) => `${d.code} ${d.message}`).join("\n") || "accepted").toBe("refused as stated")
  })

const FB = `FUNCTION_BLOCK FB_T
VAR_INPUT
\tIN : BOOL;
END_VAR
VAR_OUTPUT
\tQ : BOOL;
END_VAR
%LANGUAGE ST
Q := IN;
END_FUNCTION_BLOCK
`

const ld = (decls: string, body: string) =>
  `${FB}PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE LD\n${body}END_PROGRAM\n`

test("a plain-ST network body is ST: its boxes and wires resolve and type, a wrong type is the ST error", () => {
  const src = ld(
    "\ta, b, c, x, y, lamp, hot : BOOL;\n\ti, n : INT;\n\tt1 : FB_T;",
    "%NETWORK\n%WIRES w1, w2\nw1 := a AND NOT b;\nx := w1;\ny := w1 OR c;\nt1(IN := w1, Q => w2);\nlamp := w2;\n" +
      "hot := GT(i, 3);\nn := ADD(i, 1, 2);\nx := MOVE_EN(EN := GT_ENONLY(EN := a, i, n), 1, OUT => n);\n",
  )
  expect([...diagnose(src), ...vgDiags(src)].map((d) => d.message)).toEqual([])
  const wrong = ld("\ta, x : BOOL;\n\ti : INT;", "%NETWORK\nx := ADD(i, 1);\n")
  expect(diagnose(wrong).map((d) => d.message)).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
})

test("a disabled network is not compiled: no finding inside it, and its label is no jump target", () => {
  const src = ld("\ta, x : BOOL;", "%NETWORK\n%DISABLED\nl9:\nx := nowhere;\n%NETWORK\nJMP(l9, a);\n")
  expect(diagnose(src).map((d) => d.message)).toEqual(["No such label 'L9' within the scope of the JMP statement"])
})

test("a jump and a return are functions on their value: JMP(label, value) names a label, in a tree too, and no IF stands in a network", () => {
  const src = ld("\ta, c, d, y : BOOL;", "%NETWORK\nJMP(l9, a);\nRETURN(c);\ny := JMP(l9, c) AND d;\n%NETWORK\nl9:\ny := a;\n")
  expect([...diagnose(src), ...vgDiags(src)].map((d) => d.message)).toEqual([])
  const missing = ld("\tc, y : BOOL;", "%NETWORK\ny := JMP(nowhere, c);\n")
  expect(diagnose(missing).map((d) => d.message)).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement"])
  const typed = ld("\tc : BOOL;\n\ti : INT;", "%NETWORK\nl1:\ni := JMP(l1, c);\n")
  expect(diagnose(typed).map((d) => d.message)).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  const iff = ld("\ta : BOOL;", "%NETWORK\nl1:\nIF a THEN JMP l1; END_IF;\n")
  expect(vgDiags(iff).map((d) => d.message)).toContain("a network holds no IF: a jump on a value is JMP(label, value), a return RETURN(value)")
})

test("an UNSUPPORTED network keeps its label under its line: still the jump target, and nothing else stands there", () => {
  const ok = ld("\ta : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\n%NETWORK\nJMP(l9, a);\n")
  expect([...diagnose(ok), ...vgDiags(ok)].map((d) => d.message)).toEqual([])
  const more = ld("\ta, x : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\nx := a;\n")
  expect(vgDiags(more).map((d) => d.message)).toContain("a network shown %UNSUPPORTED holds nothing else but its label")
})

test("an Execute box's EN is code: a name it reads resolves, the ST under it is the box's own", () => {
  const src = ld("\ta : BOOL;\n\tn : INT;", "%NETWORK\n%EXECUTE(EN := nowhere)\nn := n + 1;\n%END_EXECUTE\n")
  expect(diagnose(src).map((d) => d.message)).toEqual(["Identifier 'nowhere' not defined"])
})

test("GT(a, b) stays the vendor's syntax error in ST: only a network spells a box as a call", () => {
  const st = `PROGRAM P\nVAR\n\tx : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nx := GT(i, 3);\nEND_PROGRAM\n`
  expect(diagnose(st).some((d) => d.message === "Expression expected instead of 'GT'")).toBe(true)
})
