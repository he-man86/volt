/**
 * THE PLAIN-ST CASE SET, ON THE EDITOR'S SIDE (openspec network-text-st 2.3, design.md oracle 2): every case of
 * `packages/volt-cli/test/fixtures/network-text-st` — the files the bridge's `StNetworkCaseTests` reads. An accept case
 * is a plain-ST network body the network check says nothing about; a refuse case is refused by it, with its phrase — so
 * the LSP refuses while typing what the bridge's reader refuses, and a case the two judge differently fails both suites.
 * Then the check's rules one by one, each on a small made-up network.
 */
import { expect, test } from "bun:test"
import { isPlainStNetworkBody, parseSource, sourceStatements, stmtExprs, unitBodies, walkExpr, walkStatements } from "../../../frontend/syntax/index.js"
import { caseRoot, programOf, readCases } from "../../../../test/support/network-cases.js"
import { networkDiags } from "../../../../test/support/network-docs.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const CASES = readCases(caseRoot("network-text-st"))

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
    "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := a AND INVERT(b);\nASSIGN(w1, Q => x);\nASSIGN(w1 OR c, Q => y);\nASSIGN(t1(IN := w1), Q => lamp);\n" +
      "ASSIGN(GT(i, 3), Q => hot);\nASSIGN(ADD(i, 1, 2), Q => n);\nASSIGN(MOVE(EN := GT(EN := a, i, n).OUT, 1, OUT => n), Q => x);\n",
  )
  expect([...diagnose(src), ...networkDiags(src)].map((d) => d.message)).toEqual([])
  const wrong = ld("\ta, x : BOOL;\n\ti : INT;", "%NETWORK\nASSIGN(ADD(i, 1), Q => x);\n")
  expect(diagnose(wrong).map((d) => d.message)).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
})

test("a disabled network is not compiled: no finding inside it, and its label is no jump target", () => {
  const src = ld("\ta, x : BOOL;", "%NETWORK\n%DISABLED\nl9:\nASSIGN(nowhere, Q => x);\n%NETWORK\nASSIGN(a, Q => JMP.l9);\n")
  expect(diagnose(src).map((d) => d.message)).toEqual(["No such label 'L9' within the scope of the JMP statement"])
})

test("a jump and a return are ASSIGN's targets on its value: Q => JMP.label names a label, in a tree too, and no IF stands in a network", () => {
  const src = ld("\ta, c, d, y : BOOL;", "%NETWORK\nASSIGN(a, Q => JMP.l9);\nASSIGN(c, Q => RETURN);\nASSIGN(ASSIGN(c, Q => JMP.l9) AND d, Q => y);\n%NETWORK\nl9:\nASSIGN(a, Q => y);\n")
  expect([...diagnose(src), ...networkDiags(src)].map((d) => d.message)).toEqual([])
  const missing = ld("\tc, y : BOOL;", "%NETWORK\nASSIGN(c, Q => y, Q => JMP.nowhere);\n")
  expect(diagnose(missing).map((d) => d.message)).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement"])
  const typed = ld("\tc : BOOL;\n\ti : INT;", "%NETWORK\nl1:\nASSIGN(c, Q => i, Q => JMP.l1);\n")
  expect(diagnose(typed).map((d) => d.message)).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  const iff = ld("\ta : BOOL;", "%NETWORK\nl1:\nIF a THEN JMP l1; END_IF;\n")
  expect(networkDiags(iff).map((d) => d.message)).toContain("a network holds no IF: a jump on a value is ASSIGN(value, Q => JMP.label), a return ASSIGN(value, Q => RETURN)")
})

test("a bracket groups a chain inside a tighter or the same chain, and nothing else (as the bridge's reader)", () => {
  const brackets = (code: string) =>
    networkDiags(ld("\ta, b, c, x : BOOL;", `%NETWORK\n${code}\n`)).filter((d) => d.message.startsWith("a bracket that groups nothing")).length
  for (const ok of ["ASSIGN(a AND (b OR c), Q => x);", "ASSIGN(a AND (b AND c), Q => x);", "ASSIGN(NOT(a OR b), Q => x);", "ASSIGN(ASSIGN(c, Q => JMP.l1) AND a, Q => x);"])
    expect([ok, brackets(ok)]).toEqual([ok, 0])
  for (const bad of ["ASSIGN(a AND (b), Q => x);", "ASSIGN((a AND b), Q => x);", "ASSIGN(a OR (b AND c), Q => x);", "ASSIGN(MOVE((a OR b)), Q => x);"])
    expect([bad, brackets(bad)]).toEqual([bad, 1])
})

test("an UNSUPPORTED network keeps its label under its line: still the jump target, and nothing else stands there", () => {
  const ok = ld("\ta : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\n%NETWORK\nASSIGN(a, Q => JMP.l9);\n")
  expect([...diagnose(ok), ...networkDiags(ok)].map((d) => d.message)).toEqual([])
  const more = ld("\ta, x : BOOL;", "%NETWORK\n%UNSUPPORTED \"an edge contact\" #0011aabb\nl9:\nASSIGN(a, Q => x);\n")
  expect(networkDiags(more).map((d) => d.message)).toContain("a network shown %UNSUPPORTED holds nothing else but its label")
})

test("an Execute box's EN is code, and its ST is ST where it stands in its CODE string: each name it reads resolves", () => {
  const src = ld("\ta : BOOL;\n\tn : INT;", "%NETWORK\nASSIGN(EXECUTE(EN := nowhere, 'n := n + 1;\n  IF a THEN m := $'x$'; END_IF') AND a, Q => ok);\n")
  const found = diagnose(src).map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}' ${d.span.startLine}:${d.span.startCol}`)
  const line = src.split("\n").findIndex((l) => l.startsWith("  IF a")) + 1
  const ok = src.split("\n")[line - 1]!.indexOf("ok)")
  expect(found.sort()).toEqual([
    "Identifier 'ok' not defined at 'ok' " + line + ":" + ok,
    "Identifier 'nowhere' not defined at 'nowhere' " + (line - 1) + ":21",
    "Identifier 'm' not defined at 'm' " + line + ":12",
    "'ok' is no valid assignment target at 'ok' " + line + ":" + ok,
    "'m' is no valid assignment target at 'm' " + line + ":12",
  ].sort())
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
  const src = ld("\ti, j, k : INT;\n\tx : BOOL;", "%NETWORK\nASSIGN(SUB(i, j, k), Q => i);\n%NETWORK\nASSIGN(GT(EN := x, i, j, k).OUT, Q => x);\n%NETWORK\nASSIGN(ADD(i), Q => j);\n")
  expect(networkDiags(src).map((d) => d.message)).toEqual(["'-' needs exactly '2' operands", "'>' needs exactly '2' operands", "'+' needs at least '2' operands"])
  expect(networkDiags(src, "twincat").map((d) => d.message)[0]).toBe("'-' needs exactly '2' Operands")
  expect(networkDiags(ld("\ti, j : INT;\n\tx : BOOL;", "%NETWORK\nASSIGN(SUB(i, j), Q => i);\nASSIGN(AND(x, x, x), Q => x);\n"))).toEqual([])
})

test("a METHOD box given positional pins is the build's count of its inputs: the push names no method's pins", () => {
  const src = `FUNCTION_BLOCK FB_M\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD M_twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\n%LANGUAGE ST\nM_twice := k * 2;\nEND_METHOD\n` +
    `PROGRAM P\nVAR\n\tfbm : FB_M;\n\tv, y : INT;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nASSIGN(fbm.M_twice(v), Q => y);\n%NETWORK\nASSIGN(fbm.M_twice(k := v), Q => y);\nEND_PROGRAM\n`
  expect(networkDiags(src).map((d) => d.message)).toEqual(["Function 'M_twice' requires exactly '1' inputs"])
})

// THE UNNAMED OPERAND (openspec network-unnamed-operand): `???` is an operand wherever network text takes one, as the
// bridge's reader reads it (`StNetworkReader.TryOperandSpan`), so the rung stays in the tree; the build reads the marker
// as text, the pair of `network_unnamed_input_pin` / `network_unnamed_group_operand` (both vendors) at each `???`
const UNNAMED_OPERANDS = "%NETWORK\nASSIGN(??? AND a, Q => x);\n%NETWORK\nASSIGN(a, Q => ???);\n%NETWORK\nASSIGN(MOVE(EN := a, ???, OUT => ???), Q => x);\n%NETWORK\nt1(IN := ???);\n"
const unnamedSrc = ld("\ta, x : BOOL;\n\tt1 : FB_T;", UNNAMED_OPERANDS)

test("??? in every operand position is an identifier ??? with its span, and every statement stays in the tree", () => {
  const unit = parseSource(unnamedSrc, { networkText: true, unicodeIdentifiers: false }, "codesys").units.at(-1)!
  const statements = unitBodies(unit).filter(isPlainStNetworkBody).flatMap((b) => sourceStatements(b).statements)
  expect(statements.map((s) => s.kind)).toEqual(["assign", "assign", "assign", "call_stmt"])
  const unnamed: string[] = []
  walkStatements(statements, (s) => {
    if (s.kind === "assign") walkExpr(s.target, (e) => e.kind === "ident_expr" && e.name === "???" && unnamed.push(unnamedSrc.slice(e.span.start, e.span.end)))
    for (const e of stmtExprs(s)) walkExpr(e, (x) => x.kind === "ident_expr" && x.name === "???" && unnamed.push(unnamedSrc.slice(x.span.start, x.span.end)))
  })
  expect(unnamed.length).toBeGreaterThanOrEqual(5)
  expect(new Set(unnamed)).toEqual(new Set(["???"]))
})

test("an unnamed operand is the build's pair on the ???'s first ?, in each vendor's words, and nothing else in its statement", () => {
  // the build places both on the operand at offset 0, length 1 (live CODESYS 3.5.21.40, assign-states#0442,0443)
  const src = ld("\ta, x : BOOL;", "%NETWORK\nASSIGN(??? AND a, Q => x);\n")
  const at = src.indexOf("???")
  expect(diagnose(src).map((d) => [d.message, d.span.start, d.span.end])).toEqual([
    ["Expression expected instead of '?'", at, at + 1],
    ["Unexpected token '?' found", at, at + 1],
  ])
  expect(diagnose(src, "twincat").map((d) => d.message)).toEqual(["Expression expected instead of '?'", "Unexpected Token '?' found"])
  // a box input, positional and named: the same pair at each; the coil its own message, and an operator's value
  // (`MOVE(…, OUT => ???)`) the coil's too (box-states#0433)
  const pair = ["Expression expected instead of '?'@?", "Unexpected token '?' found@?"]
  const target = "The assignment target is not specified.@???"
  expect(diagnose(unnamedSrc).map((d) => `${d.message}@${unnamedSrc.slice(d.span.start, d.span.end)}`).sort()).toEqual(
    [...pair, ...pair, ...pair, target, target].sort(),
  )
})

test("??? on an FB's declared output is C0007 alone, a function's value the pair, on its first ? (box-states#0047,0153,0205); a jump's label names no label (assign-states#0496,0497)", () => {
  const fn = `FUNCTION F2 : BOOL\nVAR_INPUT\n\ta : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tq1 : BOOL;\nEND_VAR\n%LANGUAGE ST\nF2 := a;\nEND_FUNCTION\n`
  const src = `${fn}${ld("\ta, go : BOOL;\n\tt1 : FB_T;", "%NETWORK\nt1(EN := go, IN := a, Q => ???);\n%NETWORK\nF2(EN := go, a := a, OUT => ???);\n%NETWORK\nASSIGN(a, Q => JMP.???);\n")}`
  const at = (from: string) => src.indexOf("???", src.indexOf(from))
  expect(diagnose(src).map((d) => [d.message, d.span.start, d.span.end])).toEqual([
    ["No such label '???' within the scope of the JMP statement", at("JMP.???"), at("JMP.???") + 3],
    ["Expression expected instead of '?'", at("Q => ???"), at("Q => ???") + 1],
    ["Expression expected instead of '?'", at("OUT => ???"), at("OUT => ???") + 1],
    ["Unexpected token '?' found", at("OUT => ???"), at("OUT => ???") + 1],
  ])
})

test("??? in an ST body stays the vendor's syntax error", () => {
  const st = `PROGRAM P\nVAR\n\ta, x : BOOL;\nEND_VAR\n%LANGUAGE ST\nx := ??? AND a;\nEND_PROGRAM\n`
  expect(diagnose(st).some((d) => d.code === "syntax-error" && d.message === "Expression expected instead of '?'")).toBe(true)
})

test("a FUNCTION box given more pins than it declares, positional and named together, is the build's count", () => {
  const fn = `FUNCTION F_inc : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nF_inc := i + 1;\nEND_FUNCTION\n`
  const src = `${fn}PROGRAM P\nVAR\n\tv, w, y : INT;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nASSIGN(F_inc(v, i := w), Q => y);\n%NETWORK\nASSIGN(F_inc(v), Q => y);\nEND_PROGRAM\n`
  expect(networkDiags(src).map((d) => d.message)).toEqual(["Function 'F_inc' requires exactly '1' inputs"])
})

test("on CODESYS a library function's box named through its namespace and shown with EN, so with ENO, reads ENO as a member", () => {
  const src = ld("\tx : BOOL;\n\ttxt : STRING;", "%NETWORK\nASSIGN(Standard.LEN(EN := TRUE, txt), Q => x);\n")
  expect(networkDiags(src).map((d) => d.message)).toEqual(["'ENO' is no component of 'LEN'"])
  expect(networkDiags(src, "twincat")).toEqual([])
})

test("a coil nobody named, Q => ???, is the build's own error in each vendor's words, and nothing else", () => {
  const src = ld("\ta : BOOL;\n\tgo : BOOL;", "%NETWORK\nASSIGN(a, Q => ???);\n%NETWORK\nASSIGN(MOVE(EN := go, 1, OUT => a), Q => ???);\n")
  expect(diagnose(src)).toEqual(networkDiags(src)) // the network check is all the pipeline says
  expect(networkDiags(src).map((d) => d.message)).toEqual(["The assignment target is not specified.", "The assignment target is not specified."])
  expect(networkDiags(src, "twincat").map((d) => d.message)).toEqual(["Assignment target not specified", "Assignment target not specified"])
})

test("an Execute box's CODE string not closed yet runs to its body's end, no further: the units after it keep their findings", () => {
  const unit = (code: string) =>
    `FUNCTION_BLOCK FB1\nVAR\n\tgo : BOOL;\n\tn : INT;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nEXECUTE(EN := go, '${code}\n` +
    `END_FUNCTION_BLOCK\nMETHOD M\n%LANGUAGE ST\nn := 'x';\nnowhere := 1;\nEND_METHOD\n`
  const method = (src: string) => diagnose(src).filter((d) => d.span.startLine >= 10).map((d) => `${d.message}@${d.span.startLine}`)
  const closed = method(unit("n := 1;');"))
  expect(closed).toEqual(["Cannot convert type 'STRING(INT#1)' to type 'INT'@12", "Identifier 'nowhere' not defined@13", "'nowhere' is no valid assignment target@13"])
  expect(method(unit("n := 1;"))).toEqual(closed)
  expect(networkDiags(unit("n := 1;")).map((d) => d.message)).toContain("an unclosed string")
})

test("the operand a COMMENT wraps is the operand: its name resolves and types, an undefined one is the ST error", () => {
  const said = (body: string) => {
    const src = ld("\ta, y : BOOL;\n\ti : INT;", body)
    return diagnose(src).map((d) => `${d.message} at '${src.slice(d.span.start, d.span.end)}'`)
  }
  const commented = said("%NETWORK\nASSIGN(COMMENT(a, 'why'), Q => y);\nASSIGN(COMMENT(nowhere, 'x'), Q => COMMENT(y, 'w'));\nASSIGN(COMMENT(i, 'n'), Q => y);\n")
  expect(commented).toEqual(said("%NETWORK\nASSIGN(a, Q => y);\nASSIGN(nowhere, Q => y);\nASSIGN(i, Q => y);\n"))
  expect(commented).toContain("Identifier 'nowhere' not defined at 'nowhere'")
})

test("COMMENT is the text's own: declared in reach, it is refused as RAIL and OPERAND are", () => {
  const src = ld("\ta, y, COMMENT : BOOL;", "%NETWORK\nASSIGN(COMMENT(a, 'why'), Q => y);\n")
  expect(networkDiags(src).map((d) => d.message)).toContain("the call COMMENT names something declared in reach, which the text reads as its own operand comment")
})

test("a wire's definition with no value is the ST parser's error in a network too (openspec network-empty-pin-value)", () => {
  expect(diagnose(ld("\ty : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := ;\nASSIGN(w1, Q => y);\n")).map((d) => d.message)).toEqual([
    "Expression expected instead of ';'",
    "the wire w1 is named and never defined",
  ])
})

test("a box's output store converts as an assignment does: a change of sign warns, a narrowing does not build, on the target (box-states#1119-1126)", () => {
  const fn = `FUNCTION F2 : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_OUTPUT\n\tq1 : INT;\nEND_VAR\n%LANGUAGE ST\nF2 := a;\nq1 := a + 1;\nEND_FUNCTION\n`
  const at = (src: string, from: string) => src.indexOf(from.slice(from.indexOf("=> ") + 3), src.indexOf(from))
  const body = [
    "MOVE(EN := go, i, OUT => u);",
    "MOVE(EN := go, dd, OUT => k);",
    "MOVE(EN := go, w, OUT => k);",
    "MOVE(i, OUT => u);",
    "MOVE(dd, OUT => k);",
    "F2(EN := go, a := i, OUT => u);",
    "F2(EN := go, a := i, OUT => k, q1 => u);",
    "F2(EN := go, a := i, OUT => sv);",
  ]
  const src = `${fn}${ld("\tgo : BOOL;\n\ti, k : INT;\n\tu : UINT;\n\tw : UINT := 5;\n\tdd : DINT;\n\tsv : SINT;", body.map((s) => `%NETWORK\n${s}\n`).join(""))}`
  const sign = "Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign"
  expect(diagnose(src).map((d) => [d.severity, d.message, d.span.start, d.span.end])).toEqual([
    ["warning", sign, at(src, body[0]!), at(src, body[0]!) + 1],
    ["error", "Cannot convert type 'DINT' to type 'INT'", at(src, body[1]!), at(src, body[1]!) + 1],
    ["warning", "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign", at(src, body[2]!), at(src, body[2]!) + 1],
    ["warning", sign, at(src, body[3]!), at(src, body[3]!) + 1],
    ["error", "Cannot convert type 'DINT' to type 'INT'", at(src, body[4]!), at(src, body[4]!) + 1],
    ["warning", sign, at(src, body[5]!), at(src, body[5]!) + 1],
    ["warning", sign, src.indexOf("u", src.indexOf("q1 => u")) , src.indexOf("u", src.indexOf("q1 => u")) + 1],
    ["error", "Cannot convert type 'INT' to type 'SINT'", at(src, body[7]!), at(src, body[7]!) + 2],
  ])
})

test("an unnamed ??? input takes no type from a ??? target elsewhere in the network: each ??? is its own unknown", () => {
  const timer = "FUNCTION_BLOCK FB_P\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\n%LANGUAGE ST\nQ := IN;\nEND_FUNCTION_BLOCK\n"
  const src = `${timer}${ld("\ta, x : BOOL;\n\tt1 : FB_P;", "%NETWORK\nASSIGN(t1(IN := a, PT := ???), Q => x);\nASSIGN(a, Q => ???);\n")}`
  expect([...diagnose(src), ...networkDiags(src)].map((d) => d.message).filter((m) => m.startsWith("Cannot convert"))).toEqual([])
})
