/**
 * THE NETWORK WORDS — what a plain-ST network body holds beyond ST, each with its class and what it runs as: the words of
 * its `%` lines (`%LANGUAGE`, `%NETWORK`, `%DISABLED`, `%UNSUPPORTED`), a receiver's marks (`NOT y :=`, `t1(RISING IN :=`,
 * `NOT Q =>`), `RAIL()` and the network's own boxes (`BRANCH`, `BRANCH_SHORTCIRCUIT`, `EXECUTE`, `OPERAND`, a value's edge
 * `RISING(a)`), the jump and the return as targets (`JMP.l :=`, `RETURN :=`) and the network's labels (`l:`).
 *
 * Read off what the network-text front-end already produces (`plainStText`: its `%` lines and each receiver's marks;
 * `sourceStatements`: its labels) and the body's own tokens, so only a body the reader took as network text answers —
 * a variable named `rail` in an ST body stays a variable. Semantic tokens, completion and hover all read this one list.
 */
import {
  allUnits,
  isPlainStNetworkBody,
  isTrivia,
  languageLineWords,
  plainStText,
  sourceStatements,
  unitBodies,
  walkStatements,
  type BodySpan,
  type Span,
  type Token,
  type TopLevel,
} from "../../frontend/syntax/index.js"
import { labelMeaning, markMeaning, NETWORK_MEANINGS, type MarkReceiver, type NetworkForm } from "./network-meanings.js"

/** The semantic-token class of a network word (a subset of the server's legend). */
type NetworkWordKind = "keyword" | "function" | "label"

interface NetworkWord {
  start: number
  end: number
  kind: NetworkWordKind
  /** What it runs as, one line (`network-meanings.ts`). */
  meaning: string
}

/** The boxes a network has that no declaration names: a word, then `(`. */
const NETWORK_CALLS: readonly NetworkForm[] = ["RAIL", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND", "RISING", "FALLING"]

/** The `%` lines of a network. */
const PERCENT_LINES: readonly NetworkForm[] = ["NETWORK", "DISABLED", "UNSUPPORTED"]

/** The words of a `%LANGUAGE` line that say a meaning of their own. */
const LANGUAGE_LINE: readonly NetworkForm[] = ["LD", "FBD", "UNSUPPORTED"]

/** `word`, where it is one of `forms`. */
const formIn = (forms: readonly NetworkForm[], word: string): NetworkForm | undefined => forms.find((f) => f === word)

const cache = new WeakMap<BodySpan, readonly NetworkWord[]>()

/** The plain-ST network bodies of a parse. */
export function networkBodies(units: readonly TopLevel[]): BodySpan[] {
  return allUnits(units).flatMap((u) => unitBodies(u).filter(isPlainStNetworkBody))
}

/** Every network word of a parse, in source order. */
export function networkWords(units: readonly TopLevel[]): NetworkWord[] {
  return networkBodies(units).flatMap(bodyWords)
}

/** The network word at `offset`, if one stands there. */
export function networkWordAt(units: readonly TopLevel[], offset: number): NetworkWord | undefined {
  return networkWords(units).find((w) => w.start <= offset && offset < w.end)
}

/** The labels a network body declares (`l:`), as written. */
export function networkLabels(body: BodySpan): string[] {
  const out: string[] = []
  walkStatements(sourceStatements(body).statements, (s) => {
    if (s.kind === "label") out.push(s.name.text)
  })
  return out
}

/** The network words of one body. */
function bodyWords(body: BodySpan): readonly NetworkWord[] {
  let words = cache.get(body)
  if (words === undefined) cache.set(body, (words = readWords(body)))
  return words
}

function readWords(body: BodySpan): NetworkWord[] {
  const out: NetworkWord[] = []
  const add = (span: Span, kind: NetworkWordKind, meaning: string) => out.push({ start: span.start, end: span.end, kind, meaning })
  const form = (span: Span, kind: NetworkWordKind, f: NetworkForm) => add(span, kind, NETWORK_MEANINGS[f])
  const lang = languageLineWords(body)
  for (const w of lang) {
    const key = w.text.toUpperCase()
    form(w.span, "keyword", formIn(LANGUAGE_LINE, key) ?? "LANGUAGE") // `%` and `LANGUAGE` say the line's meaning
  }
  const text = plainStText(body)
  for (const n of text.networks)
    for (const l of n.lines) {
      // the `%` and its key, each a token of its own; a key the form does not have is the network check's finding
      const key = formIn(PERCENT_LINES, l.key)
      if (key === undefined) continue
      form({ ...l.span, end: l.span.start + 1 }, "keyword", key)
      form({ ...l.span, start: l.span.start + 1, end: l.span.start + 1 + l.key.length }, "keyword", key)
    }
  walkStatements(sourceStatements(body).statements, (s) => {
    if (s.kind === "label") add(s.name.span, "label", labelMeaning(s.name.text, false))
  })
  const tokens = body.tokens.filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
  const marked = [...text.marks.entries()]
  // the calls open around each token: true for a call's `(`, false for a grouping one
  const parens: boolean[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const word = t.text.toUpperCase()
    const next = tokens[i + 1]
    if (t.kind === "punct" && t.text === "(") parens.push(isWordToken(tokens[i - 1]))
    else if (t.kind === "punct" && t.text === ")") parens.pop()
    else if (t.kind === "punct" && t.text === ";") parens.length = 0
    const call = isWordToken(t) && isPunct(next, "(") ? formIn(NETWORK_CALLS, word) : undefined
    const mark = marked.find(([, m]) => m.span.start <= t.span.start && t.span.end <= m.span.end)
    if (mark !== undefined && isWordToken(t)) add(t.span, "keyword", markMeaning(word, receiverOf(tokens, i, mark[0], parens)))
    else if (call !== undefined) form(t.span, "function", call)
    else if (t.kind === "keyword" && word === "JMP" && isPunct(next, ".")) {
      form(t.span, "keyword", "JMP")
      const label = tokens[i + 2]
      if (label?.kind === "identifier") add(label.span, "label", labelMeaning(label.text, true))
    } else if (t.kind === "keyword" && word === "RETURN" && (isPunct(next, ":=") || isPunct(next, "S=") || isPunct(next, "R=")))
      form(t.span, "keyword", "RETURN")
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The receiver the mark `tokens[at]` stands before (its first token at offset `receiverStart`): an output where `=>`
 *  follows it, a pin where the marks open a call's argument, else a coil. */
function receiverOf(tokens: readonly Token[], at: number, receiverStart: number, parens: readonly boolean[]): MarkReceiver {
  let r = at
  while (tokens[r]!.span.start !== receiverStart) r++
  const name = tokens[r]!.text
  let op = r + 1
  while (op < tokens.length && !RECEIVER_OPERATORS.some((p) => isPunct(tokens[op], p))) op++
  if (isPunct(tokens[op], "=>")) return { kind: "output", name }
  // the token before the mark words opens a call's argument: the `(` of a call or a `,` inside one
  let before = at - 1
  while (before >= 0 && MARK_WORDS.has(tokens[before]!.text.toUpperCase())) before--
  const opensArgument = isPunct(tokens[before], "(") || isPunct(tokens[before], ",")
  return { kind: opensArgument && parens[parens.length - 1] === true ? "pin" : "coil", name }
}

const RECEIVER_OPERATORS = [":=", "S=", "R=", "=>"]
const MARK_WORDS: ReadonlySet<string> = new Set(["NOT", "RISING", "FALLING"])

const isWordToken = (t: Token | undefined): boolean => t !== undefined && (t.kind === "identifier" || t.kind === "keyword")
const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text.toUpperCase() === text
