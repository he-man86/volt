/**
 * THE WORD SCANNER — identifiers and keywords, the `#`-typed literals a word opens (`T#10ms`, `DATE#…`, `INT#42`,
 * `E_Mode#Running`), and the ExST assignment operators `S=` `R=` `REF=`.
 */
import { isAlnum, isDigit, isIdentCont, isIdentStart } from "./chars.js"
import { lexBasedDigits, lexDigits, lexTimeLiteralBody } from "./numbers.js"
import {
  DATE_PREFIXES,
  DATETIME_PREFIXES,
  REFUSED_LITERAL_PREFIXES,
  TIME_PREFIXES,
  TOD_PREFIXES,
  TWINCAT_LITERAL_PREFIXES,
  TYPED_INTEGER_PREFIXES,
  TYPED_PREFIXES,
} from "./prefixes.js"
import { MALFORMED, RADIXES, type Scanner } from "./scanner.js"
import { lexQuotedString } from "./strings.js"
import { CODESYS_ONLY_KEYWORDS, KEYWORDS, type Keyword } from "./vocabulary.js"

// Keyword lookup — upper-cased key → canonical keyword.
const KEYWORD_MAP: Map<string, Keyword> = new Map(KEYWORDS.map((k) => [k, k]))

/** Scans one identifier, keyword, `#`-typed literal or ExST operator at the cursor, if a word starts there. */
export function scanWord(s: Scanner): boolean {
  if (!isIdentStart(s.peek())) return false
  while (s.more && isIdentCont(s.peek())) s.advance(1)
  const upper = s.text().toUpperCase()

  // Check for #-suffixed literal forms: T#10ms, DATE#…,
  // TOD#…, DT#…, INT#42, …
  if (s.peek() === "#" && scanTypedLiteral(s, upper)) return true

  // ─── ExST assignment operators: S=, R=, REF= ──────────────
  // Per docs/codesys-reference/01-languages-and-editors.md, ExST
  // extends ST with Set (`S=`), Reset (`R=`), and reference-
  // rebind (`REF=`) assignment operators. They're a single
  // token. We recognize them only when the identifier IS
  // exactly the operator stem AND the next char is `=` (not
  // `=>` or `==`) — otherwise leave the identifier intact.
  if ((upper === "S" || upper === "R" || upper === "REF") && s.peek() === "=" && s.peek(1) !== ">" && s.peek(1) !== "=") {
    s.advance(1)
    s.emit("punct")
    return true
  }

  const keyword = s.tc && CODESYS_ONLY_KEYWORDS.has(upper) ? undefined : KEYWORD_MAP.get(upper)
  if (keyword !== undefined) {
    s.emit("keyword", { keyword })
  } else {
    s.emit("identifier")
  }
  return true
}

/**
 * The literal the word `upper` opens with the `#` at the cursor — whether one was scanned (if not, the identifier stands
 * and the `#` is an unknown token).
 *
 * A PREFIX THE VENDOR DOES NOT HAVE IS STILL ONE TOKEN, `#` included: its own errors quote `LDATE#`
 * whole ("Unexpected Token 'LDATE#' found"), then the date's pieces separately. Lexing it as an
 * identifier plus a stray `#` cascades differently and the difference is visible in every message.
 * On TwinCAT that is every word that is no literal prefix there; on both, `STRING#` and `WSTRING#`. It is a
 * typed literal the vendor refuses whole (`Token.malformed`), so the parser refuses it where any refused literal
 * is refused — a body's operand, an initializer — with the same cascade.
 */
function scanTypedLiteral(s: Scanner, upper: string): boolean {
  if (REFUSED_LITERAL_PREFIXES.has(upper) || (s.tc && !TWINCAT_LITERAL_PREFIXES.has(upper))) {
    s.advance(1)
    s.emit("typed_lit", MALFORMED)
    return true
  }
  if (TIME_PREFIXES.has(upper)) {
    s.advance(1)
    s.emit("time_lit", lexTimeLiteralBody(s, upper.startsWith("L")) ? undefined : MALFORMED)
    return true
  }
  if (DATE_PREFIXES.has(upper)) return scanBody(s, "date_lit", "-")
  if (TOD_PREFIXES.has(upper)) return scanBody(s, "tod_lit", ":.")
  if (DATETIME_PREFIXES.has(upper)) return scanBody(s, "datetime_lit", "-:.")
  if (TYPED_INTEGER_PREFIXES.has(upper)) {
    s.advance(1)
    s.emit("typed_lit", lexTypedIntegerBody(s) ? undefined : MALFORMED)
    return true
  }
  if (upper === "BOOL") {
    s.advance(1)
    s.emit("typed_lit", lexTypedBoolBody(s) ? undefined : MALFORMED)
    return true
  }
  if (TYPED_PREFIXES.has(upper)) {
    s.advance(1)
    lexTypedLiteralBody(s)
    s.emit("typed_lit")
    return true
  }
  return scanWordOperand(s)
}

/**
 * ANY OTHER WORD BEFORE `#` TAKES ONE OPERAND, and CODESYS reads the pair as one: a quoted string (`UCHAR#'A'`
 * and `UTF8#'…'` are literals — `QUOTED_LITERAL_PREFIXES`, single quote only — every other pair asks for a
 * component, "''A'' is no component of 'CHAR'"), or a word or a number (`CHAR#65`, `E_Mode#Running`).
 * What the pair means is `literal/value`'s (`typedLiteralForm`); here it is one `typed_lit` (`lit_*`, S10–S13).
 * Anything else after the `#` is unmeasured: the identifier stands and the `#` is an unknown token.
 */
function scanWordOperand(s: Scanner): boolean {
  const afterHash = s.peek(1)
  if (afterHash === "'" || afterHash === '"') {
    s.advance(1) // #
    lexQuotedString(s, s.peek() as '"' | "'")
    s.emit("typed_lit")
    return true
  }
  if (isIdentCont(afterHash)) {
    s.advance(1) // #
    while (s.more && isIdentCont(s.peek())) s.advance(1)
    s.emit("typed_lit")
    return true
  }
  return false
}

/**
 * A date, time-of-day or date-and-time body after its `#`: digits and the separators `separators` — `-` for a DATE
 * (YYYY-MM-DD), `:` and `.` for a TOD, all three for a DATE_AND_TIME (YYYY-MM-DD-HH:MM:SS.sss).
 */
function scanBody(s: Scanner, kind: "date_lit" | "tod_lit" | "datetime_lit", separators: string): boolean {
  s.advance(1)
  while (s.more) {
    const c = s.peek()
    if (isDigit(c) || (c !== "" && separators.includes(c))) {
      s.advance(1)
    } else {
      break
    }
  }
  s.emit(kind)
  return true
}

/**
 * A typed integer or bit string's body (`INT#`, `WORD#`, …) — whether it is well formed. An optional `-`, then digits,
 * then, UNSIGNED only, a `#` and that base's digits (`WORD#16#FF`, `INT#-5`: `lit_*_typed`). Both vendors refuse
 * what else there is at its first character: `INT#+5` is the token `INT#` (`lit_int_typed_plus`), `INT#-16#10` the
 * token `INT#-16` and then `#` (`lit_int_typed_negative_based`).
 */
function lexTypedIntegerBody(s: Scanner): boolean {
  const signed = s.peek() === "-"
  if (signed) s.advance(1)
  const digitsStart = s.pos
  if (!lexDigits(s)) return false
  if (s.peek() !== "#") return true
  if (signed) return false
  const base = Number(s.src.slice(digitsStart, s.pos).replace(/_/g, ""))
  s.advance(1)
  return RADIXES.has(base) && lexBasedDigits(s, base)
}

/**
 * A typed BOOL's body is ONE character, and only `0` and `1` are values: `BOOL#TRUE` is the refused token `BOOL#T` and
 * then the name `RUE`, `BOOL#2` is refused whole (`lit_bool_typed_*`, both vendors).
 */
function lexTypedBoolBody(s: Scanner): boolean {
  const c = s.peek()
  if (!isAlnum(c)) return false
  s.advance(1)
  return c === "0" || c === "1"
}

function lexTypedLiteralBody(s: Scanner): void {
  // Body: depends on the type. We accept any non-whitespace
  // alphanumeric/sign/dot/hash sequence — the parser can
  // validate against the prefix type later. `#` is IN the set: a
  // typed BASED literal carries a second `#` (`WORD#16#1`, `DWORD#2#1010`).
  while (s.more) {
    const c = s.peek()
    if (isAlnum(c) || c === "_" || c === "." || c === "+" || c === "-" || c === "#") {
      s.advance(1)
    } else {
      break
    }
  }
}
