/**
 * Plain-ST network text's front-end (`plain-st.ts`): which body is in the form, its networks and `%` lines, and the token
 * stream the ST statement parser reads — a `%` line trivia, an Execute box the call `EXECUTE(…)`, an operator box word
 * heading a call where an operand starts, and a `%DISABLED` network's code out of the compiled stream.
 */
import { expect, test } from "bun:test"
import { isTrivia, type Token } from "../lex/tokens.js"
import { lex as lexSource } from "../lex/lexer.js"
import { plainStText } from "./plain-st.js"
import type { BodySpan } from "../ast/nodes/index.js"

const body = (text: string): BodySpan => {
  const tokens = lexSource(text, "codesys").filter((t) => t.kind !== "eof")
  return { kind: "body", tokens, span: { start: 0, end: text.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }, dialect: "codesys" }
}
const code = (tokens: readonly Token[]) => tokens.filter((t) => !isTrivia(t.kind)).map((t) => (t.kind === "keyword" ? t.text.toUpperCase() + "!" : t.text)).join(" ")

test("networks and their % lines: the title, %DISABLED, %WIRES, an Execute box from its line to %END_EXECUTE", () => {
  const t = plainStText(body("%NETWORK \"one\"\n%DISABLED\n%WIRES w1, w2\nx := a;\n%NETWORK\n%EXECUTE(EN := c)\nn := 1;\n%END_EXECUTE\n"))
  expect(t.networks.map((n) => [n.header.args.map((a) => a.text).join(""), n.disabled, n.wires.map((w) => w.name), n.executes.length])).toEqual([
    ['"one"', true, ["w1", "w2"], 0],
    ["", false, [], 1],
  ])
  expect(t.stray).toEqual([])
})

test("the statement tokens: % lines are trivia, an Execute box is the call EXECUTE(…) with a `;` of no width", () => {
  const t = plainStText(body("%NETWORK\n%WIRES w1\n%EXECUTE(EN := c)\nn := 1;\n%END_EXECUTE\n"))
  expect(code(t.sourceTokens)).toBe("EXECUTE ( EN := c ) ; n := 1 ;")
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

test("what the form cannot hold is named: code before the first network, an unknown % line, an Execute box left open", () => {
  expect(plainStText(body("x := a;\n%NETWORK\n")).stray.map((s) => s.message)).toEqual(["'x' before the first %NETWORK line: a network body opens with %NETWORK"])
  expect(plainStText(body("%NETWORK\n%COLOR red\n")).stray.map((s) => s.message)).toEqual(["'%COLOR': a network holds no such line"])
  expect(plainStText(body("%NETWORK\n%EXECUTE(EN := a)\nx := 1;\n")).stray.map((s) => s.message)).toEqual(["%EXECUTE with no %END_EXECUTE"])
})
