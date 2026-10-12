/**
 * THE PUNCTUATION SCANNER — backtick-quoted identifiers, multi- and single-character punctuators, and the unknown
 * character the lexer recovers over. The last scanner `lex` asks: it always scans a token.
 */
import { MULTI_CHAR_PUNCT, SINGLE_CHAR_PUNCT } from "./prefixes.js"
import type { Scanner } from "./scanner.js"

/** Scans one punctuator, backtick identifier or unknown character at the cursor. */
export function scanPunctuation(s: Scanner): true {
  const ch = s.peek()

  // ─── Backtick-quoted identifier (CODESYS extension) ────────
  // Per docs/codesys-reference/08-identifiers.md, names enclosed
  // in backticks (acute accent U+00B4 per spec; ASCII `` ` ``
  // accepted as a tolerance) can contain special characters and
  // even keywords. The backticks ARE part of the identifier —
  // `var1` and ``var1`` are distinct names.
  if (ch === "`" || ch === "´") {
    const opener = ch
    s.advance(1)
    while (s.more && s.peek() !== opener && s.peek() !== "\n") {
      s.advance(1)
    }
    if (s.peek() === opener) {
      s.advance(1)
      s.emit("identifier")
    } else {
      // Unterminated — emit as unknown.
      s.emit("unknown")
    }
    return true
  }

  // ─── Multi-char punctuation (longest match first) ──────────
  const multi = matchMultiCharPunct(s)
  if (multi !== undefined) {
    s.advance(multi.length)
    s.emit("punct")
    return true
  }

  // ─── Single-char punctuation ───────────────────────────────
  if (SINGLE_CHAR_PUNCT.includes(ch)) {
    s.advance(1)
    s.emit("punct")
    return true
  }

  // ─── Unknown — single char, recover ────────────────────────
  s.advance(1)
  s.emit("unknown")
  return true
}

function matchMultiCharPunct(s: Scanner): string | undefined {
  for (const m of MULTI_CHAR_PUNCT) {
    let ok = true
    for (let i = 0; i < m.length; i++) {
      if (s.peek(i) !== m[i]) {
        ok = false
        break
      }
    }
    if (ok) return m
  }
  return undefined
}
