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
import { networkDiags } from "../../../../test/support/network-docs.js"
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
  // a `pou` line is a function the body can call (declaring its own EN, as the 55 library POUs that do, 1c); a signature
  // line (`fb TON IN PT => Q ET`, `function g IN => Q`, `program p => Q`) the callee as its declaration states it, and a bare
  // `fb Axis` a block type with no pin
  const pous = c.scope.flatMap((line) => {
    const w = line.split(/\s+/)
    if (w[0] === "pou" && w.length === 2) return [`FUNCTION ${w[1]} : BOOL\nVAR_INPUT\n\tEN : BOOL;\nEND_VAR\n%LANGUAGE ST\n${w[1]} := EN;\nEND_FUNCTION\n`]
    if (w[0] === "fb" && w.length === 2) return [`FUNCTION_BLOCK ${w[1]}\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n`]
    const arrow = w.indexOf("=>")
    if (!["fb", "function", "program"].includes(w[0]!) || arrow < 2) return []
    const vars = (kind: string, names: string[]) => (names.length === 0 ? "" : `${kind}\n${names.map((n) => `\t${n} : BOOL;\n`).join("")}END_VAR\n`)
    const io = vars("VAR_INPUT", w.slice(2, arrow)) + vars("VAR_OUTPUT", w.slice(arrow + 1))
    const [head, end] = w[0] === "fb" ? [`FUNCTION_BLOCK ${w[1]}`, "END_FUNCTION_BLOCK"] : w[0] === "function" ? [`FUNCTION ${w[1]} : BOOL`, "END_FUNCTION"] : [`PROGRAM ${w[1]}`, "END_PROGRAM"]
    return [`${head}\n${io}%LANGUAGE ST\n\n${end}\n`]
  })
  return `${pous.join("")}PROGRAM CaseProgram\nVAR\n\tvolt_case_unused : BOOL;\n${decls.join("\n")}\nEND_VAR\n${c.text}END_PROGRAM\n`
}

const findings = (src: string) => networkDiags(src).filter((d) => d.code === "network-plain-st")

test("the case set is there: every v2 accept case as a pull writes it, and a refusal per rule", () => {
  expect(CASES.filter((c) => c.accept).length).toBeGreaterThanOrEqual(100)
  expect(CASES.filter((c) => !c.accept).length).toBeGreaterThanOrEqual(25)
})

for (const c of CASES.filter((x) => x.accept))
  test(`accept ${c.file}/${c.name}: read by the ST parser, nothing the network check refuses`, () => {
    const src = programOf(c)
    if (c.text.split("\n")[1]?.startsWith("%NETWORK"))
      expect(unitBodies(parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys").units.at(-1)!).some(isPlainStNetworkBody)).toBe(true)
    expect(findings(src).map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}'`)).toEqual([])
  })

for (const c of CASES.filter((x) => !x.accept))
  test(`refuse ${c.file}/${c.name}: ${c.code} '${c.phrase}'`, () => {
    const all = networkDiags(programOf(c))
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
    "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a AND NOT b;\nx := w1;\ny := w1 OR c;\nlamp := t1(IN := w1);\n" +
      "hot := GT(i, 3);\nn := ADD(i, 1, 2);\nx := MOVE(EN := GT(EN := a, i, n), 1, OUT => n).ENO;\n",
  )
  expect([...diagnose(src), ...networkDiags(src)].map((d) => d.message)).toEqual([])
  const wrong = ld("\ta, x : BOOL;\n\ti : INT;", "%NETWORK\nx := ADD(i, 1);\n")
  expect(diagnose(wrong).map((d) => d.message)).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
})

test("a disabled network is not compiled: no finding inside it, and its label is no jump target", () => {
  const src = ld("\ta, x : BOOL;", "%NETWORK\n%DISABLED\nl9:\nx := nowhere;\n%NETWORK\nJMP(l9, a);\n")
  expect(diagnose(src).map((d) => d.message)).toEqual(["No such label 'L9' within the scope of the JMP statement"])
})

test("a jump and a return are functions on their value: JMP(label, value) names a label, in a tree too, and no IF stands in a network", () => {
  const src = ld("\ta, c, d, y : BOOL;", "%NETWORK\nJMP(l9, a);\nRETURN(c);\ny := JMP(l9, c) AND d;\n%NETWORK\nl9:\ny := a;\n")
  expect([...diagnose(src), ...networkDiags(src)].map((d) => d.message)).toEqual([])
  const missing = ld("\tc, y : BOOL;", "%NETWORK\ny := JMP(nowhere, c);\n")
  expect(diagnose(missing).map((d) => d.message)).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement"])
  const typed = ld("\tc : BOOL;\n\ti : INT;", "%NETWORK\nl1:\ni := JMP(l1, c);\n")
  expect(diagnose(typed).map((d) => d.message)).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  const iff = ld("\ta : BOOL;", "%NETWORK\nl1:\nIF a THEN JMP l1; END_IF;\n")
  expect(networkDiags(iff).map((d) => d.message)).toContain("a network holds no IF: a jump on a value is JMP(label, value), a return RETURN(value)")
})

test("an UNSUPPORTED network keeps its label under its line: still the jump target, and nothing else stands there", () => {
  const ok = ld("\ta : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\n%NETWORK\nJMP(l9, a);\n")
  expect([...diagnose(ok), ...networkDiags(ok)].map((d) => d.message)).toEqual([])
  const more = ld("\ta, x : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\nx := a;\n")
  expect(networkDiags(more).map((d) => d.message)).toContain("a network shown %UNSUPPORTED holds nothing else but its label")
})

test("an Execute box's EN is code, and its ST is ST where it stands in its CODE string: each name it reads resolves", () => {
  const src = ld("\ta : BOOL;\n\tn : INT;", "%NETWORK\nok := EXECUTE(EN := nowhere, CODE := 'n := n + 1;\n  IF a THEN m := $'x$'; END_IF') AND a;\n")
  const found = diagnose(src).map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}' ${d.span.startLine}:${d.span.startCol}`)
  const line = src.split("\n").findIndex((l) => l.startsWith("  IF a")) + 1
  expect(found).toEqual([
    "Identifier 'ok' not defined at 'ok' " + (line - 1) + ":0",
    "Identifier 'nowhere' not defined at 'nowhere' " + (line - 1) + ":20",
    "Identifier 'm' not defined at 'm' " + line + ":12",
    "'ok' is no valid assignment target at 'ok' " + (line - 1) + ":0",
    "'m' is no valid assignment target at 'm' " + line + ":12",
  ])
  expect(networkDiags(src).filter((d) => d.code === "network-plain-st")).toEqual([])
})

test("GT(a, b) stays the vendor's syntax error in ST: only a network spells a box as a call", () => {
  const st = `PROGRAM P\nVAR\n\tx : BOOL;\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nx := GT(i, 3);\nEND_PROGRAM\n`
  expect(diagnose(st).some((d) => d.message === "Expression expected instead of 'GT'")).toBe(true)
})

test("an FB box with no instance, the call of its type, is the build's errors over the marker ??? at its head", () => {
  const src = ld("\ta : BOOL;", "%NETWORK\nFB_T(IN := a);\n")
  expect(diagnose(src)).toEqual(networkDiags(src)) // the network check is all the pipeline says
  expect(networkDiags(src).map((d) => d.message)).toEqual([
    "Expression expected instead of '?'",
    "Unexpected token '?' found",
    "Program name, function or function block instance expected instead of '!!!'ERROR'!!!'",
    "Expression expected instead of '?'",
  ])
  expect(networkDiags(src, "twincat").map((d) => d.message)[1]).toBe("Unexpected Token '?' found")
})

test("an operator box with an input count its symbol does not take is the build's error, in each vendor's words", () => {
  const src = ld("\ti, j, k : INT;\n\tx : BOOL;", "%NETWORK\ni := SUB(i, j, k);\n%NETWORK\nx := GT(EN := x, i, j, k);\n%NETWORK\nj := ADD(i);\n")
  expect(networkDiags(src).map((d) => d.message)).toEqual(["'-' needs exactly '2' operands", "'>' needs exactly '2' operands", "'+' needs at least '2' operands"])
  expect(networkDiags(src, "twincat").map((d) => d.message)[0]).toBe("'-' needs exactly '2' Operands")
  expect(networkDiags(ld("\ti, j : INT;\n\tx : BOOL;", "%NETWORK\ni := SUB(i, j);\nx := AND(x, x, x);\n"))).toEqual([])
})

test("a METHOD box given positional pins is the build's count of its inputs: the push names no method's pins", () => {
  const src = `FUNCTION_BLOCK FB_M\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD M_twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\n%LANGUAGE ST\nM_twice := k * 2;\nEND_METHOD\n` +
    `PROGRAM P\nVAR\n\tfbm : FB_M;\n\tv, y : INT;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\ny := fbm.M_twice(v);\n%NETWORK\ny := fbm.M_twice(k := v);\nEND_PROGRAM\n`
  expect(networkDiags(src).map((d) => d.message)).toEqual(["Function 'M_twice' requires exactly '1' inputs"])
})

test("??? as an operand is the build's reading of the marker as text: the token error beside the parser's", () => {
  const src = ld("\ta, x : BOOL;", "%NETWORK\nx := AND(???, a);\n")
  expect(networkDiags(src).map((d) => d.message)).toEqual(["Unexpected token '?' found"])
  expect(networkDiags(src, "twincat").map((d) => d.message)).toEqual(["Unexpected Token '?' found"])
})

test("a FUNCTION box given more pins than it declares, positional and named together, is the build's count", () => {
  const fn = `FUNCTION F_inc : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nF_inc := i + 1;\nEND_FUNCTION\n`
  const src = `${fn}PROGRAM P\nVAR\n\tv, w, y : INT;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\ny := F_inc(v, i := w);\n%NETWORK\ny := F_inc(v);\nEND_PROGRAM\n`
  expect(networkDiags(src).map((d) => d.message)).toEqual(["Function 'F_inc' requires exactly '1' inputs"])
})

test("on CODESYS a library function's box named through its namespace and shown with ENO reads ENO as a member", () => {
  const src = ld("\tx : BOOL;\n\ttxt : STRING;", "%NETWORK\nx := Standard.LEN(txt).ENO;\n")
  expect(networkDiags(src).map((d) => d.message)).toEqual(["'ENO' is no component of 'LEN'"])
  expect(networkDiags(src, "twincat")).toEqual([])
})

test("a coil nobody named, ??? := v, is the build's own error in each vendor's words, and nothing else", () => {
  const src = ld("\ta : BOOL;\n\tgo : BOOL;", "%NETWORK\n??? := a;\n%NETWORK\n??? := MOVE(EN := go, 1, OUT => a).ENO;\n")
  expect(diagnose(src)).toEqual(networkDiags(src)) // the network check is all the pipeline says
  expect(networkDiags(src).map((d) => d.message)).toEqual(["The assignment target is not specified.", "The assignment target is not specified."])
  expect(networkDiags(src, "twincat").map((d) => d.message)).toEqual(["Assignment target not specified", "Assignment target not specified"])
})

test("an Execute box's CODE string not closed yet runs to its body's end, no further: the units after it keep their findings", () => {
  const unit = (code: string) =>
    `FUNCTION_BLOCK FB1\nVAR\n\tgo : BOOL;\n\tn : INT;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nEXECUTE(EN := go, CODE := '${code}\n` +
    `END_FUNCTION_BLOCK\nMETHOD M\n%LANGUAGE ST\nn := 'x';\nnowhere := 1;\nEND_METHOD\n`
  const method = (src: string) => diagnose(src).filter((d) => d.span.startLine >= 10).map((d) => `${d.message}@${d.span.startLine}`)
  const closed = method(unit("n := 1;');"))
  expect(closed).toEqual(["Cannot convert type 'STRING(INT#1)' to type 'INT'@12", "Identifier 'nowhere' not defined@13", "'nowhere' is no valid assignment target@13"])
  expect(method(unit("n := 1;"))).toEqual(closed)
  expect(networkDiags(unit("n := 1;")).map((d) => d.message)).toContain("an unclosed string")
})
