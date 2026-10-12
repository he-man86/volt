/**
 * THE STRING SCANNER — single-quoted STRING and double-quoted WSTRING literals, and the quoted body a typed literal
 * takes (`UCHAR#'A'`, `words.ts`).
 */
import { isHexDigit } from "./chars.js"
import { MALFORMED, type Scanner } from "./scanner.js"

/** Scans one STRING or WSTRING literal at the cursor, if one starts there. */
export function scanString(s: Scanner): boolean {
  const ch = s.peek()

  // ─── String literal (single-quoted, IEC STRING) ────────────
  if (ch === "'") {
    lexQuotedString(s, "'")
    s.emit("string_lit")
    return true
  }

  // ─── WString literal (double-quoted, IEC WSTRING) ──────────
  if (ch === '"') {
    s.emit("wstring_lit", lexQuotedString(s, '"') ? undefined : MALFORMED)
    return true
  }
  return false
}

/**
 * A quoted string — and whether it is WELL FORMED, which only a WSTRING's hex escape can make it not: it is FOUR hex
 * digits, and both vendors refuse a shorter run (`esc_wstring_hex_41`, `_ff`, `_pair`, `hex3`; four digits and five
 * build). THE VENDORS STOP IN DIFFERENT PLACES, and their messages quote how far they got: CODESYS reads the whole
 * literal and then refuses it (`'"$C3$A9"'`), TwinCAT ends the token at the short run (`'"$C3'`). A STRING's hex
 * escape is two digits; `$` before anything else is a named escape and takes one character.
 */
export function lexQuotedString(s: Scanner, quote: '"' | "'"): boolean {
  let wellFormed = true
  s.advance(1) // opening quote
  while (s.more) {
    const c = s.peek()
    if (c === "\n") break // IEC strings don't span lines (lexer recovery)
    if (c === "$") {
      s.advance(1)
      const esc = s.peek()
      if (esc === "\n" || esc === "") break
      if (isHexDigit(esc)) {
        // up to 4 hex chars — a token boundary only; the decoder (`literal/string`) reads a STRING's two
        let n = 0
        while (n < 4 && isHexDigit(s.peek())) {
          s.advance(1)
          n += 1
        }
        if (quote === '"' && n < 4) {
          wellFormed = false
          if (s.tc) return false
        }
      } else {
        s.advance(1)
      }
      continue
    }
    if (c === quote) {
      s.advance(1) // closing quote
      return wellFormed
    }
    s.advance(1)
  }
  // Unterminated — return with cursor wherever we stopped; token span reflects partial consumption.
  return wellFormed
}
