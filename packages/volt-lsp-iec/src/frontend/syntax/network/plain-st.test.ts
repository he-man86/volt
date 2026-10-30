/**
 * Plain-ST network text's front-end (`plain-st.ts`): which body is in the form, its networks and `%` lines, and the token
 * stream the ST statement parser reads — a `%` line trivia, an Execute box the call `EXECUTE(EN := …)` with its ST's
 * statements after its statement, an operator box word
 * heading a call where an operand starts, and a `%DISABLED` network's code out of the compiled stream.
 */
import { expect, test } from "bun:test"
import { isTrivia, type Token } from "../lex/tokens.js"
import { lex as lexSource } from "../lex/lexer.js"
import { plainStText } from "./plain-st.js"
import type { BodySpan } from "../ast/nodes/index.js"

const body = (text: string): BodySpan => {
  const tokens = lexSource(text, "codesys", false).filter((t) => t.kind !== "eof")
  return { kind: "body", tokens, span: { start: 0, end: text.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }, dialect: "codesys", unicodeIdentifiers: false }
}
const code = (tokens: readonly Token[]) => tokens.filter((t) => !isTrivia(t.kind)).map((t) => (t.kind === "keyword" ? t.text.toUpperCase() + "!" : t.text)).join(" ")

test("networks and their % lines: the title, %DISABLED, the wires, an Execute box from EXECUTE to its ), its ST the string's content", () => {
  const src = "%NETWORK \"one\"\n%DISABLED\nVAR_TEMP w1 : ANY; w2 : ANY; END_VAR\nx := a;\n%NETWORK\nEXECUTE(EN := c, CODE := 'n := 1;\n%QX0.1 := $'a$$$';');\n"
  const t = plainStText(body(src))
  expect(t.networks.map((n) => [n.header.args.map((a) => a.text).join(""), n.disabled, n.wires.map((w) => w.name), n.executes.length])).toEqual([
    ['"one"', true, ["w1", "w2"], 0],
    ["", false, [], 1],
  ])
  const x = t.networks[1]!.executes[0]!
  expect([src.slice(x.call.start, x.call.end).startsWith("EXECUTE(") && src.slice(x.call.start, x.call.end).endsWith("')"), src.slice(x.code.start, x.code.end), x.st])
    .toEqual([true, "n := 1;\n%QX0.1 := $'a$$$';", "n := 1;\n%QX0.1 := 'a$';"])
  expect(t.stray).toEqual([])
})

test("the statement tokens: % lines are trivia, an Execute box is the call EXECUTE(EN := …), its ST after its statement", () => {
  const src = "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nx := EXECUTE(EN := c, CODE := 'n := $'a$';\n  m := 2;') AND d;\ny := b;\n"
  const t = plainStText(body(src))
  expect(code(t.sourceTokens)).toBe("x := EXECUTE ( EN := c ) AND! d ; n := 'a' ; m := 2 ; y := b ;")
  // each token of the ST where it stands in the string, through the escapes
  const m = t.sourceTokens.find((k) => k.text === "m")!
  expect([src.slice(m.span.start, m.span.end), m.span.startLine, m.span.startCol]).toEqual(["m", 4, 2])
  const lit = t.sourceTokens.find((k) => k.text === "'a'")!
  expect(src.slice(lit.span.start, lit.span.end)).toBe("$'a$'")
})

test("an operator box word heading a call where an operand starts is the box; after an operand it is the contact", () => {
  const t = plainStText(body("%NETWORK\nx := AND(a, NOT(b)) AND GT(i, 3);\nADD(i, j, OUT => n);\ny := TRUE AND(c);\n"))
  expect(code(t.sourceTokens)).toBe("x := AND ( a , NOT ( b ) ) AND! GT ( i , 3 ) ; ADD ( i , j , OUT => n ) ; y := TRUE! AND! ( c ) ;")
})

test("a disabled network's code is out of the compiled tokens, and in the tokens as written", () => {
  const t = plainStText(body("%NETWORK\n%DISABLED\nl9:\nx := a;\n%NETWORK\ny := b;\n"))
  expect(code(t.statementTokens)).toBe("y := b ;")
  expect(code(t.sourceTokens)).toBe("l9 : x := a ; y := b ;")
})

test("what the form cannot hold is named: code before the first network, an unknown % line, an escape the code does not have", () => {
  expect(plainStText(body("x := a;\n%NETWORK\n")).stray.map((s) => s.message)).toEqual(["'x' before the first %NETWORK line: a network body opens with %NETWORK"])
  expect(plainStText(body("%NETWORK\n%COLOR red\n")).stray.map((s) => s.message)).toEqual(["'%COLOR': a network holds no such line"])
  expect(plainStText(body("%NETWORK\nEXECUTE(CODE := 'x := $N;');\n")).stray.map((s) => s.message))
    .toEqual(["the escape '$N' in the Execute box's CODE: its code spells a ' as $' and a $ as $$, and everything else as it stands"])
})
