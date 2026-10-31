/**
 * AN OPERAND HOLDING ST TEXT, `OPERAND('<its text>')` (openspec network-text-one-to-one F2; the bridge's `StNetworkWriter`
 * `OperandText` and `StNetworkReader` `Element`): an IDE operand box an engineer typed an expression into, which is no
 * plain operand. Its text is one string in ST escaping (`$'`, `$$`). The statement tokens read it as the ST it is — the call
 * `OPERAND(` and the string become `(` and the text's own tokens, each where it stands in the string — so the ST engine
 * types, checks and lowers it; the network check exempts its span (`operands`), where infix and calls are the operand's
 * own ST, no box.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Dialect } from "../lex/vocabulary.js"
import type { Span } from "../span.js"
import { codeTokens, contentSpan } from "./execute-code.js"

export const OPERAND = "OPERAND"

const FORM = "OPERAND takes one string, '<the operand's text>', and names no output"

function next(tokens: readonly Token[], k: number): number {
  let n = k + 1
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  return n
}

const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text === text

/** Is `tokens[at]` the word OPERAND heading a call? */
export function isOperandHead(tokens: readonly Token[], at: number): boolean {
  const t = tokens[at]!
  return (t.kind === "identifier" || t.kind === "keyword") && t.text.toUpperCase() === OPERAND && isPunct(tokens[next(tokens, at)], "(")
}

/** Whether `text`'s tokens are one plain operand — a literal, or a name chain `a.b[i]^.c` — which is written as it stands. */
function plain(tokens: readonly Token[]): boolean {
  let depth = 0
  for (const [k, t] of tokens.entries()) {
    if (isPunct(t, "[")) depth++
    else if (isPunct(t, "]")) depth--
    else if (depth > 0) continue
    else if (isPunct(t, "(")) return false
    else if (t.kind === "punct" && t.text !== "." && t.text !== "^" && !(k === 0 && t.text === "-" && tokens.length === 2)) return false
    else if (t.kind === "keyword" && !["TRUE", "FALSE"].includes(t.text.toUpperCase())) return false
  }
  return tokens.length > 0
}

/**
 * The OPERAND call at `at` taken: its head trivia, its `(` and `)` kept, its string replaced by the text's own tokens; the
 * index of its string, else of its `(` where the form is not `OPERAND('…')`. A finding (the form, an escape, an empty or a
 * plain text) goes to `stray`; the text's span to `operands`.
 */
export function takeOperand(
  tokens: readonly Token[],
  at: number,
  dialect: Dialect,
  unicodeIdentifiers: boolean,
  into: { out: Token[]; stray: { message: string; span: Span }[]; operands: Span[] },
): number {
  const open = next(tokens, at)
  const string = next(tokens, open)
  const close = next(tokens, string)
  into.out.push({ ...tokens[at]!, kind: "whitespace", keyword: undefined })
  for (let k = at + 1; k < open; k++) into.out.push(tokens[k]!)
  into.out.push(tokens[open]!)
  const s = tokens[string]
  if (s?.kind !== "string_lit" || !s.text.startsWith("'") || !isPunct(tokens[close], ")") || isPunct(tokens[next(tokens, close)], ".")) {
    into.stray.push({ message: FORM, span: tokens[at]!.span })
    return open
  }
  for (let k = open + 1; k < string; k++) into.out.push(tokens[k]!)
  const text = codeTokens(s, dialect, unicodeIdentifiers, "an operand's text")
  if (typeof text === "string") {
    into.stray.push({ message: text, span: s.span })
    into.out.push(s)
  } else if (text.tokens.length === 0) into.stray.push({ message: "OPERAND holds no text: an empty operand is ;", span: s.span })
  else if (plain(text.tokens)) into.stray.push({ message: `OPERAND(${s.text}): a plain operand is written as it stands`, span: s.span })
  if (typeof text !== "string") into.out.push(...text.tokens)
  into.operands.push(contentSpan(s))
  return string
}
