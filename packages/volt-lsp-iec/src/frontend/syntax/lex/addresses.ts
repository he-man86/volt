/**
 * THE ADDRESS SCANNER — `%`-prefixed direct addresses (`%IX0.0`, `%QB7`, `%I*`) and CODESYS's partial access after a
 * `.` (`x.%X0`).
 */
import { isAddressAreaChar, isAddressSizeChar, isDigit, isPartialAccessWidth } from "./chars.js"
import type { Scanner } from "./scanner.js"
import { isTrivia, type Token } from "./tokens.js"

/**
 * Scans one address or partial access at the cursor, if one starts there.
 *
 * ─── %-prefix address literal ──────────────────────────────
 * Per docs/codesys-reference/05-operands.md:
 *   %<area><size>?<position>[.<bit>]
 *   <area> ∈ {I, Q, M} ; <size> ∈ {X, B, W, D, L}
 *   <position> = digits (or `*` for incomplete; or multi-segment
 *   `2.5.7.1` for device-config-dependent forms)
 *   Examples: %IX0.0, %Q7.5, %IW215, %QB7, %MD48, %I*, %IW2.5.7.1
 * Recognized as a single `address_lit` token to keep parser
 * rules simple. We're permissive on the body content — only
 * the leading `%` + area letter is required.
 * ─── CODESYS partial access `x.%X0` / `.%B3` / `.%W1` / `.%D0` ───
 * A bit, byte, word or double-word slice of an integer, right after a `.`: ONE token, the member's name. It is
 * CODESYS's extension — TwinCAT reads the `%` as a member of its own and leaves the specifier for the statement
 * ("'%' is no component of 'd'", "';' expected instead of 'W0'", `accepts_partial_access`, both vendors 2026-09-21),
 * so on TwinCAT the `%` stays a mark and the parser says so (`parse/expression` `parsePostfix`).
 */
export function scanAddress(s: Scanner): boolean {
  if (s.peek() !== "%") return false
  if (!s.tc && isPartialAccessWidth(s.peek(1)) && isDigit(s.peek(2)) && lastMeaningful(s.tokens)?.text === ".") {
    s.advance(2)
    while (s.more && isDigit(s.peek())) s.advance(1)
    s.emit("identifier")
    return true
  }

  if (!isAddressAreaChar(s.peek(1))) return false
  s.advance(1) // %
  s.advance(1) // area letter
  // The incomplete address's `*` stands RIGHT AFTER the area: `%I*` builds, `%IW*` is "Direct address expected
  // after AT instead of %IW" — the address ends before the `*` (`lit_address_incomplete*`, both vendors 2026-10-01).
  if (s.peek() === "*") {
    s.advance(1)
    s.emit("address_lit")
    return true
  }
  // Optional size character (X/B/W/D/L), then the position: digits and dots. Whether the shape is one the vendor
  // takes is `literal/address`'s.
  if (isAddressSizeChar(s.peek())) s.advance(1)
  while (s.more && (isDigit(s.peek()) || s.peek() === ".")) s.advance(1)
  s.emit("address_lit")
  return true
}

/** The last token that is not trivia, if any. */
function lastMeaningful(tokens: readonly Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) if (!isTrivia(tokens[i]!.kind)) return tokens[i]
  return undefined
}
