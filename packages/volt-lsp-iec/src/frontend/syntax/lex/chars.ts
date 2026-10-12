/**
 * THE LEXER'S CHARACTER PREDICATES — one character in, one class out. Shared by the token-class scanners.
 */

export function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n"
}

/** A partial access's width letter — X, B, W or D, either case (the four measured, `operand_partial_*`). */
export function isPartialAccessWidth(c: string): boolean {
  return "XBWDxbwd".includes(c) && c !== ""
}

export function isAddressAreaChar(c: string): boolean {
  return c === "I" || c === "Q" || c === "M" || c === "i" || c === "q" || c === "m"
}

export function isAddressSizeChar(c: string): boolean {
  return (
    c === "X" ||
    c === "B" ||
    c === "W" ||
    c === "D" ||
    c === "L" ||
    c === "x" ||
    c === "b" ||
    c === "w" ||
    c === "d" ||
    c === "l"
  )
}

export function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"
}

/** A digit of `base` (2, 8, 10 or 16), letters in either case. */
export function isBaseDigit(c: string, base: number): boolean {
  if (c.length !== 1) return false
  const d = parseInt(c, 16)
  return !Number.isNaN(d) && d < base
}

export function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F")
}

export function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
}

export function isAlnum(c: string): boolean {
  return isAlpha(c) || isDigit(c)
}

export function isIdentStart(c: string): boolean {
  return isAlpha(c) || c === "_"
}

export function isIdentCont(c: string): boolean {
  return isAlnum(c) || c === "_"
}
