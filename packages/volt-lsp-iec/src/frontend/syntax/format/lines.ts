/**
 * READING LINES OUT OF A TOKEN STREAM — the Volt file format's rules are about whole lines (the `IMPLEMENTATION` line,
 * `%FOLDER`, a network's header), while the lexer hands out tokens. These are the shared line readers.
 */
import type { Span } from "../span.js"
import { isTrivia, type Token } from "../lex/tokens.js"

/** Where a problem with the file format is reported, and what it says. */
export type ReportAt = (message: string, span: Span) => void

/** One source line around `tokens[at]`: its text, and the index of the token holding the newline that ends it
 *  (`tokens.length` when the stream ends first). `code` blanks comments and pragmas, as the bridge's `StTrivia.Code`
 *  does, for the network-header test; the keyword's own test reads the raw line, so a comment on it disqualifies it. */
export function lineAround(tokens: readonly Token[], at: number, code = false): { text: string; end: number } {
  const piece = (t: Token): string =>
    code && (t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma")
      ? t.text.replace(/[^\n]/g, " ")
      : t.text
  let before = ""
  let k = at - 1
  for (; k >= 0; k--) {
    const text = piece(tokens[k]!)
    const nl = text.lastIndexOf("\n")
    if (nl >= 0) {
      before = text.slice(nl + 1) + before
      break
    }
    before = text + before
  }
  // The stream began mid-line (a body right after `END_VAR` on the same line): the line holds text this stream does
  // not, so it is no whole line. A NUL stands for that text, which no pattern here accepts.
  if (k < 0 && (tokens[0]?.span.startCol ?? 0) > 0) before = "\u0000" + before
  let after = ""
  let end = at
  for (; end < tokens.length; end++) {
    const text = piece(tokens[end]!)
    const nl = text.indexOf("\n")
    if (nl >= 0) {
      after += text.slice(0, nl)
      break
    }
    after += text
  }
  return { text: before + after, end }
}

/** The index of the first significant (non-trivia) token at or after `from`. */
export const nextSignificant = (tokens: readonly Token[], from: number): number => {
  let i = from
  while (i < tokens.length && isTrivia(tokens[i]!.kind)) i++
  return i
}
