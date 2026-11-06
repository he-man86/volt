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
  const src = "%NETWORK \"one\"\n%DISABLED\nVAR w1 : ANY; w2 : ANY; END_VAR\nASSIGN(a, Q => x);\n%NETWORK\nEXECUTE(EN := c, 'n := 1;\n%QX0.1 := $'a$$$';');\n"
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
  const src = "%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(EXECUTE(EN := c, 'n := $'a$';\n  m := 2;') AND d, Q => x);\nASSIGN(b, Q => y);\n"
  const t = plainStText(body(src))
  expect(code(t.sourceTokens)).toBe("ASSIGN ( EXECUTE ( EN := c ) AND! d , Q => x ) ; n := 'a' ; m := 2 ; ASSIGN ( b , Q => y ) ;")
  // each token of the ST where it stands in the string, through the escapes
  const m = t.sourceTokens.find((k) => k.text === "m")!
  expect([src.slice(m.span.start, m.span.end), m.span.startLine, m.span.startCol]).toEqual(["m", 4, 2])
  const lit = t.sourceTokens.find((k) => k.text === "'a'")!
  expect(src.slice(lit.span.start, lit.span.end)).toBe("$'a$'")
})

test("an operator box word heading a call where an operand starts is the box; after an operand it is the contact", () => {
  const t = plainStText(body("%NETWORK\nASSIGN(AND(a, NOT(b)) AND GT(i, 3), Q => x);\nADD(i, j, OUT => n);\nASSIGN(TRUE AND(c), Q => y);\n"))
  expect(code(t.sourceTokens)).toBe("ASSIGN ( AND ( a , NOT ( b ) ) AND! GT ( i , 3 ) , Q => x ) ; ADD ( i , j , OUT => n ) ; ASSIGN ( TRUE! AND! ( c ) , Q => y ) ;")
})

test("a disabled network's code is out of the compiled tokens, and in the tokens as written", () => {
  const t = plainStText(body("%NETWORK\n%DISABLED\nl9:\nASSIGN(a, Q => x);\n%NETWORK\nASSIGN(b, Q => y);\n"))
  expect(code(t.statementTokens)).toBe("ASSIGN ( b , Q => y ) ;")
  expect(code(t.sourceTokens)).toBe("l9 : ASSIGN ( a , Q => x ) ; ASSIGN ( b , Q => y ) ;")
})

test("what the form cannot hold is named: code before the first network, an unknown % line, an escape the code does not have", () => {
  expect(plainStText(body("ASSIGN(a, Q => x);\n%NETWORK\n")).stray.map((s) => s.message)).toEqual(["'ASSIGN' before the first %NETWORK line: a network body opens with %NETWORK"])
  expect(plainStText(body("%NETWORK\n%COLOR red\n")).stray.map((s) => s.message)).toEqual(["'%COLOR': a network holds no such line"])
  expect(plainStText(body("%NETWORK\nEXECUTE('x := $N;');\n")).stray.map((s) => s.message))
    .toEqual(["the escape '$N' in the Execute box's ST: its code spells a ' as $' and a $ as $$, and everything else as it stands"])
})

test("a jump and the return as ASSIGN's targets read their keyword as a name; a mark word is trivia, refused naming its function", () => {
  const j = plainStText(body("%NETWORK\nASSIGN(c, Q => JMP.l, Q_INVERTED => RETURN);\n"))
  expect([code(j.sourceTokens), j.stray]).toEqual(["ASSIGN ( c , Q => JMP . l , Q_INVERTED => RETURN ) ;", []])
  const m = plainStText(body("%NETWORK\nASSIGN(a AND NOT b, Q => x);\nt1(RISING IN := a);\ny := NOT := a;\n"))
  expect(code(m.sourceTokens)).toBe("ASSIGN ( a AND! b , Q => x ) ; t1 ( IN := a ) ; y := a ;")
  expect(m.stray.map((s) => s.message.slice(0, 40))).toEqual([
    "a mark is a function around a value, INV",
    "a mark before a pin: a pin's mark is a f",
    "a mark is a function around a value, INV",
  ])
})

test("an operand comment reads as the operand it wraps: a value, a coil, a pin, an output — the comment recorded", () => {
  const src = "%NETWORK\nASSIGN(COMMENT(a, 'why'), Q => y);\nASSIGN(c, Q_INVERTED => COMMENT(s.x, 'it$'s $$1$L'));\nt1(IN := COMMENT(???, 'u'), Q => COMMENT(q, 'v'));\n"
  const t = plainStText(body(src))
  expect(code(t.sourceTokens)).toBe("ASSIGN ( a , Q => y ) ; ASSIGN ( c , Q_INVERTED => s . x ) ; t1 ( IN := ??? , Q => q ) ;")
  expect(t.networks[0]!.comments.map((c) => [src.slice(c.operand.start, c.operand.end), c.text])).toEqual([["a", "why"], ["s.x", "it's $1\n"], ["???", "u"], ["q", "v"]])
  expect(t.stray).toEqual([])
})

test("an operand comment not in its form is named in the bridge's words, and left as it stands", () => {
  const stray = (s: string) => plainStText(body(`%NETWORK\n${s}\n`)).stray.map((x) => x.message)
  expect(stray("ASSIGN(COMMENT(a, ''), Q => y);")).toEqual(["COMMENT(a, ''): an empty comment is the plain operand a"])
  expect(stray("ASSIGN(COMMENT(INVERT(a), 'why'), Q => y);")[0]).toContain("the marks stand outside it")
  expect(stray("ASSIGN(COMMENT(a, b), Q => y);")[0]).toContain("takes an operand and one string")
  expect(stray("ASSIGN(COMMENT(a, 'x', 'y'), Q => y);")[0]).toContain("takes an operand and one string")
  expect(stray("ASSIGN(COMMENT(a, 'x').Q, Q => y);")[0]).toContain("takes an operand and one string")
  expect(stray("ASSIGN(COMMENT(a, 'x$N'), Q => y);")).toEqual(["the escape '$N': an operand comment spells $$ $' $L $R, every other character as it stands."])
  expect(stray("VAR w1 : ANY; END_VAR\nCOMMENT(w1, 'x') := AND(a, b);\nASSIGN(COMMENT(w1, 'x'), Q => y);"))
    .toEqual(["a comment on the wire w1: a wire is no operand", "COMMENT wraps an operand, and the marks stand outside it: INVERT(COMMENT(a, 'why')), RISING(COMMENT(a, 'why'))"])
})
