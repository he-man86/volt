/**
 * THE TRIVIA SCANNER — whitespace, line comments, nestable block comments and pragma blocks. The lexer emits them as
 * tokens; the parser filters them (`isTrivia`), refactoring and format tools that care about source fidelity read them.
 */
import { isWhitespace } from "./chars.js"
import type { Scanner } from "./scanner.js"

/** Scans one trivia token at the cursor, if one starts there. */
export function scanTrivia(s: Scanner): boolean {
  const ch = s.peek()

  // ─── Whitespace ────────────────────────────────────────────
  if (isWhitespace(ch)) {
    while (s.more && isWhitespace(s.peek())) s.advance(1)
    s.emit("whitespace")
    return true
  }

  // ─── Line comment ──────────────────────────────────────────
  if (ch === "/" && s.peek(1) === "/") {
    while (s.more && s.peek() !== "\n") s.advance(1)
    s.emit("line_comment")
    return true
  }

  // ─── Block comment (nestable) ──────────────────────────────
  if (ch === "(" && s.peek(1) === "*") {
    s.advance(2)
    let depth = 1
    while (s.more && depth > 0) {
      if (s.peek() === "(" && s.peek(1) === "*") {
        s.advance(2)
        depth += 1
      } else if (s.peek() === "*" && s.peek(1) === ")") {
        s.advance(2)
        depth -= 1
      } else {
        s.advance(1)
      }
    }
    s.emit("block_comment")
    return true
  }

  // ─── Pragma block ──────────────────────────────────────────
  // `{attribute 'qualified_only'}` etc. We lex as opaque text;
  // the parser can decode contents later if needed. Pragmas can
  // span lines in practice; we look for the matching `}`.
  if (ch === "{") {
    s.advance(1)
    while (s.more && s.peek() !== "}") s.advance(1)
    if (s.peek() === "}") s.advance(1)
    s.emit("pragma")
    return true
  }
  return false
}
