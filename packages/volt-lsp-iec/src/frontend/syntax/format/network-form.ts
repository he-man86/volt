/**
 * WHICH FORM AN LD/FBD BODY IS IN (openspec network-text-st, read-only phase): plain-ST network text opens with a
 * `%NETWORK` line (`network/plain-st.ts`), v2 network text with a `NETWORK` keyword. Both are read until 3.2 deletes v2;
 * the stated language (`%LANGUAGE LD|FBD`) says the body is a network body, this says which reader takes it.
 */
import { isTrivia, type Token } from "../lex/tokens.js"

/** The key of the `%` line `tokens[at]` opens — a `%` first on its line, then a word, touching — or undefined. */
export function percentKeyAt(tokens: readonly Token[], at: number): string | undefined {
  const t = tokens[at]!
  if (t.kind !== "punct" || t.text !== "%" || t.span.startCol !== 0) return undefined
  const next = tokens[at + 1]
  return next !== undefined && (next.kind === "identifier" || next.kind === "keyword") && next.span.start === t.span.end
    ? next.text.toUpperCase()
    : undefined
}

/** Is this LD/FBD body's text the plain-ST form: its first token that is no trivia a `%NETWORK` line? A body with no
 *  network reads the same in either form (none), and stays v2's until 3.2. */
export function isPlainStNetworkText(tokens: readonly Token[]): boolean {
  const i = tokens.findIndex((t) => !isTrivia(t.kind) && t.kind !== "eof")
  return i >= 0 && percentKeyAt(tokens, i) === "NETWORK"
}
