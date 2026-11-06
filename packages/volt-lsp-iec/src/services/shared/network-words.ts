/**
 * THE NETWORK WORDS — what a plain-ST network body holds beyond ST, each with its class and what it runs as: the words of
 * its `%` lines (`%LANGUAGE`, `%NETWORK`, `%DISABLED`, `%UNSUPPORTED`), `RAIL()` and the network's own calls (`ASSIGN` and
 * its outputs `Q`, `Q_SET`, `Q_RESET`, `Q_INVERTED`, the marks `INVERT`, `RISING`, `FALLING`, `BRANCH`,
 * `BRANCH_SHORTCIRCUIT`, `EXECUTE`, `OPERAND`, `COMMENT`), the jump and the return as targets (`Q => JMP.l`,
 * `Q => RETURN`) and the network's labels (`l:`). None of them is a symbol to resolve.
 *
 * Read off what the network-text front-end already produces (`plainStText`: its `%` lines; `sourceStatements`: its labels)
 * and the body's own tokens, so only a body the reader took as network text answers — a variable named `rail` in an ST
 * body stays a variable. Semantic tokens, completion and hover all read this one list.
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
import { labelMeaning, NETWORK_MEANINGS, type NetworkForm } from "./network-meanings.js"

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
const NETWORK_CALLS: readonly NetworkForm[] = ["RAIL", "BRANCH", "BRANCH_SHORTCIRCUIT", "EXECUTE", "OPERAND", "COMMENT", "RISING", "FALLING", "INVERT", "ASSIGN"]

/** ASSIGN's outputs, each a target's mark. */
const ASSIGN_OUTPUTS: readonly NetworkForm[] = ["Q", "Q_SET", "Q_RESET", "Q_INVERTED"]

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
  // the calls open around each token: the head word of a call's `(`, undefined for a grouping one
  const parens: (string | undefined)[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const word = t.text.toUpperCase()
    const next = tokens[i + 1]
    if (t.kind === "punct" && t.text === "(") parens.push(isWordToken(tokens[i - 1]) ? tokens[i - 1]!.text.toUpperCase() : undefined)
    else if (t.kind === "punct" && t.text === ")") parens.pop()
    else if (t.kind === "punct" && t.text === ";") parens.length = 0
    const call = isWordToken(t) && isPunct(next, "(") ? formIn(NETWORK_CALLS, word) : undefined
    const output = parens.at(-1) === "ASSIGN" && isWordToken(t) && isPunct(next, "=>") ? formIn(ASSIGN_OUTPUTS, word) : undefined
    if (call !== undefined) form(t.span, "function", call)
    else if (output !== undefined) form(t.span, "keyword", output)
    else if (t.kind === "keyword" && word === "JMP" && isPunct(next, ".")) {
      form(t.span, "keyword", "JMP")
      const label = tokens[i + 2]
      if (label?.kind === "identifier") add(label.span, "label", labelMeaning(label.text, true))
    } else if (t.kind === "keyword" && word === "RETURN" && isPunct(tokens[i - 1], "=>")) form(t.span, "keyword", "RETURN")
  }
  return out.sort((a, b) => a.start - b.start)
}

const isWordToken = (t: Token | undefined): boolean => t !== undefined && (t.kind === "identifier" || t.kind === "keyword")
const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text.toUpperCase() === text
