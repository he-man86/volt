/**
 * BALANCED-TOKEN SCANNING — the one depth rule the parser uses to take a bracketed stretch of tokens whole: a `(` or
 * `[` opens a level, a `)` or `]` closes one. A stretch is then parsed apart (bounds, initializers) in a contained
 * sub-cursor, so a malformed piece never derails the main parse.
 */
import type { Token } from "../lex/tokens.js"
import type { Span } from "../span.js"
import type { Cursor } from "./cursor.js"

/** How a token moves the bracket depth: +1 for `(` `[`, -1 for `)` `]`, 0 otherwise. */
function depthStep(t: Token, brackets: "both" | "parens"): number {
  if (t.kind !== "punct") return 0
  if (t.text === "(" || (brackets === "both" && t.text === "[")) return 1
  if (t.text === ")" || (brackets === "both" && t.text === "]")) return -1
  return 0
}

/**
 * Consume tokens at the cursor, depth-aware over `()`/`[]`, up to the first token `stop` accepts at depth 0 (left for
 * the caller) or the end. An initializer's right-hand side (up to `;`), an array dimension (up to `,`/`]`).
 */
export function collectUntilTopLevel(c: Cursor, stop: (t: Token) => boolean): Token[] {
  const out: Token[] = []
  let depth = 0
  while (!c.atEof()) {
    const t = c.peek()
    if (depth === 0 && stop(t)) break
    depth += depthStep(t, "both")
    out.push(c.consume())
  }
  return out
}

/** Consume through the `)` matching a `(` already consumed — parentheses only; returns the inner tokens and the
 *  closer's span. */
export function collectParenInner(c: Cursor): { inner: Token[]; closeSpan: Span } {
  const inner: Token[] = []
  let depth = 1
  let closeSpan = c.peek().span
  while (!c.atEof() && depth > 0) {
    const t = c.consume()
    closeSpan = t.span
    depth += depthStep(t, "parens")
    if (depth === 0) break
    inner.push(t)
  }
  return { inner, closeSpan }
}

/** Index of the first top-level `..` in a token slice (depth-aware over `()`/`[]`), or -1. */
export function topLevelDotDot(tokens: readonly Token[]): number {
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const step = depthStep(t, "both")
    depth += step
    if (step === 0 && depth === 0 && t.kind === "punct" && t.text === "..") return i
  }
  return -1
}
