/**
 * IEC 61131-3 Structured Text lexer — hand-written state machine.
 *
 * Emits *all* tokens including trivia (whitespace, comments, pragma
 * blocks). The parser filters trivia by default; refactoring / format
 * tools that care about source fidelity get them.
 *
 * Position tracking: line/col are advanced incrementally as `pos`
 * moves so we don't rescan the source for every token span. Lines are
 * 1-based, columns 0-based (matches the LSP convention).
 */
import { pointSpan, type Span } from "../span.js"
import { isTrivia, type Token, type TokenKind } from "./tokens.js"
import {
  CODESYS_ONLY_KEYWORDS,
  DATE_PREFIXES,
  DATETIME_PREFIXES,
  KEYWORDS,
  MULTI_CHAR_PUNCT,
  REFUSED_LITERAL_PREFIXES,
  SINGLE_CHAR_PUNCT,
  TIME_PREFIXES,
  TOD_PREFIXES,
  TWINCAT_LITERAL_PREFIXES,
  TYPED_INTEGER_PREFIXES,
  TYPED_PREFIXES,
  type Dialect,
  type Keyword,
} from "./vocabulary.js"

/** The bases a `<base>#` literal may name — asked of both vendors (`lit_invalid_base_*`, 2026-10-01). */
const RADIXES: ReadonlySet<number> = new Set([2, 8, 10, 16])

/** What `emit` adds to a literal the vendor refuses whole (`Token.malformed`). */
const MALFORMED = { malformed: true } as const

/** A duration's units, largest first — a literal's components must run strictly down this list (`lexTimeLiteralBody`). */
const DURATION_UNIT_RANK = ["d", "h", "m", "s", "ms", "us", "ns"]

// Keyword lookup — upper-cased key → canonical keyword.
const KEYWORD_MAP: Map<string, Keyword> = new Map(KEYWORDS.map((k) => [k, k]))

/**
 * `dialect` decides only the VOCABULARY — which words are reserved and which `<prefix>#` forms are literals
 * (see `CODESYS_ONLY_KEYWORDS`). Everything else is shared.
 *
 * REQUIRED (frontend-conformance 2.1.4). It defaulted to CODESYS, "the superset", and eight re-lexers outside the parse
 * took the default — hover, semantic tokens, reachability, the binder's `qualified_only`, the attribute readers, the
 * token under the cursor, and the network-text parser's ST fragments — so a TwinCAT project was re-read with words
 * reserved that TwinCAT does not have. A consumer reads `ParseResult.tokens` (lexed once, in the parse's dialect) or
 * passes the dialect it has.
 */
export function lex(src: string, dialect: Dialect): Token[] {
  const tc = dialect === "twincat"
  const tokens: Token[] = []
  let pos = 0
  const len = src.length
  let line = 1 // 1-based
  let col = 0 // 0-based, matches LSP

  function peek(offset = 0): string {
    return pos + offset < len ? src[pos + offset] : ""
  }

  function advance(n: number): void {
    for (let i = 0; i < n && pos < len; i++) {
      if (src[pos] === "\n") {
        line += 1
        col = 0
      } else {
        col += 1
      }
      pos += 1
    }
  }

  function spanFrom(start: number, startLine: number, startCol: number): Span {
    return {
      start,
      end: pos,
      startLine,
      startCol,
      endLine: line,
      endCol: col,
    }
  }

  function emit(kind: TokenKind, start: number, startLine: number, startCol: number, extra?: Partial<Token>): void {
    tokens.push({
      kind,
      text: src.slice(start, pos),
      span: spanFrom(start, startLine, startCol),
      ...extra,
    })
  }

  while (pos < len) {
    const startPos = pos
    const startLine = line
    const startCol = col
    const ch = peek()

    // ─── Whitespace ────────────────────────────────────────────
    if (isWhitespace(ch)) {
      while (pos < len && isWhitespace(peek())) advance(1)
      emit("whitespace", startPos, startLine, startCol)
      continue
    }

    // ─── Line comment ──────────────────────────────────────────
    if (ch === "/" && peek(1) === "/") {
      while (pos < len && peek() !== "\n") advance(1)
      emit("line_comment", startPos, startLine, startCol)
      continue
    }

    // ─── Block comment (nestable) ──────────────────────────────
    if (ch === "(" && peek(1) === "*") {
      advance(2)
      let depth = 1
      while (pos < len && depth > 0) {
        if (peek() === "(" && peek(1) === "*") {
          advance(2)
          depth += 1
        } else if (peek() === "*" && peek(1) === ")") {
          advance(2)
          depth -= 1
        } else {
          advance(1)
        }
      }
      emit("block_comment", startPos, startLine, startCol)
      continue
    }

    // ─── Pragma block ──────────────────────────────────────────
    // `{attribute 'qualified_only'}` etc. We lex as opaque text;
    // the parser can decode contents later if needed. Pragmas can
    // span lines in practice; we look for the matching `}`.
    if (ch === "{") {
      advance(1)
      while (pos < len && peek() !== "}") advance(1)
      if (peek() === "}") advance(1)
      emit("pragma", startPos, startLine, startCol)
      continue
    }

    // ─── String literal (single-quoted, IEC STRING) ────────────
    if (ch === "'") {
      lexQuotedString("'")
      emit("string_lit", startPos, startLine, startCol)
      continue
    }

    // ─── WString literal (double-quoted, IEC WSTRING) ──────────
    if (ch === '"') {
      emit("wstring_lit", startPos, startLine, startCol, lexQuotedString('"') ? undefined : MALFORMED)
      continue
    }

    // ─── Number-with-radix `16#FF`, `8#77`, `2#1010` ───────────
    // `_` separates digits anywhere in the run — doubled, trailing, right after the base's `#` (`lit_int_underscore*`
    // all build, the values read with the separators dropped). A BASE is 2, 8, 10 or 16 (`lit_invalid_base_{3,4,12}`
    // refuse the `<n>#` token whole, `lit_invalid_base_10` builds) and takes only its own digits: `2#102` is `2#10` and
    // then `2`, `16#FG` is `16#F` and then `G` (`lit_invalid_digit_*`) — the vendor's lexer ends the literal there.
    if (isDigit(ch)) {
      const radixCheckStart = pos
      while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1)
      if (peek() === "#") {
        const base = Number(src.slice(radixCheckStart, pos).replace(/_/g, ""))
        advance(1)
        if (!RADIXES.has(base)) {
          emit("int_lit", radixCheckStart, startLine, startCol, MALFORMED)
          continue
        }
        const digits = lexBasedDigits(base)
        emit("int_lit", radixCheckStart, startLine, startCol, digits ? undefined : MALFORMED)
        continue
      }
      // Otherwise rewind and let the real-number path handle
      // fractional/exponent forms. We use the offsets-based span
      // helper here because we've already advanced past the
      // integer part.
      pos = radixCheckStart
      line = startLine
      col = startCol
      lexNumber()
      // lexNumber emits its own token, so continue.
      continue
    }

    // ─── Identifier or keyword (and #-suffixed literal forms) ──
    if (isIdentStart(ch)) {
      while (pos < len && isIdentCont(peek())) advance(1)
      const text = src.slice(startPos, pos)
      const upper = text.toUpperCase()

      // Check for #-suffixed literal forms: T#10ms, DATE#…,
      // TOD#…, DT#…, INT#42, …
      // A PREFIX THE VENDOR DOES NOT HAVE IS STILL ONE TOKEN, `#` included: its own errors quote `LDATE#`
      // whole ("Unexpected Token 'LDATE#' found"), then the date's pieces separately. Lexing it as an
      // identifier plus a stray `#` cascades differently and the difference is visible in every message.
      // On TwinCAT that is every word that is no literal prefix there; on both, `STRING#` and `WSTRING#`. It is a
      // typed literal the vendor refuses whole (`Token.malformed`), so the parser refuses it where any refused literal
      // is refused — a body's operand, an initializer — with the same cascade.
      if (peek() === "#" && (REFUSED_LITERAL_PREFIXES.has(upper) || (tc && !TWINCAT_LITERAL_PREFIXES.has(upper)))) {
        advance(1)
        emit("typed_lit", startPos, startLine, startCol, MALFORMED)
        continue
      }
      if (peek() === "#") {
        if (TIME_PREFIXES.has(upper)) {
          advance(1)
          emit("time_lit", startPos, startLine, startCol, lexTimeLiteralBody(upper.startsWith("L")) ? undefined : MALFORMED)
          continue
        }
        if (DATE_PREFIXES.has(upper)) {
          advance(1)
          lexDateLiteralBody()
          emit("date_lit", startPos, startLine, startCol)
          continue
        }
        if (TOD_PREFIXES.has(upper)) {
          advance(1)
          lexTodLiteralBody()
          emit("tod_lit", startPos, startLine, startCol)
          continue
        }
        if (DATETIME_PREFIXES.has(upper)) {
          advance(1)
          lexDatetimeLiteralBody()
          emit("datetime_lit", startPos, startLine, startCol)
          continue
        }
        if (TYPED_INTEGER_PREFIXES.has(upper)) {
          advance(1)
          emit("typed_lit", startPos, startLine, startCol, lexTypedIntegerBody() ? undefined : MALFORMED)
          continue
        }
        if (upper === "BOOL") {
          advance(1)
          emit("typed_lit", startPos, startLine, startCol, lexTypedBoolBody() ? undefined : MALFORMED)
          continue
        }
        if (TYPED_PREFIXES.has(upper)) {
          advance(1)
          lexTypedLiteralBody()
          emit("typed_lit", startPos, startLine, startCol)
          continue
        }
        // ANY OTHER WORD BEFORE `#` TAKES ONE OPERAND, and CODESYS reads the pair as one: a quoted string (`UCHAR#'A'`
        // and `UTF8#'…'` are literals — `QUOTED_LITERAL_PREFIXES`, single quote only — every other pair asks for a
        // component, "''A'' is no component of 'CHAR'"), or a word or a number (`CHAR#65`, `E_Mode#Running`).
        // What the pair means is `literal/value`'s (`typedLiteralForm`); here it is one `typed_lit` (`lit_*`, S10–S13).
        const afterHash = peek(1)
        if (afterHash === "'" || afterHash === '"') {
          advance(1) // #
          lexQuotedString(peek() as '"' | "'")
          emit("typed_lit", startPos, startLine, startCol)
          continue
        }
        if (isIdentCont(afterHash)) {
          advance(1) // #
          while (pos < len && isIdentCont(peek())) advance(1)
          emit("typed_lit", startPos, startLine, startCol)
          continue
        }
        // Anything else after the `#` is unmeasured: the identifier stands and the `#` is an unknown token.
      }

      // ─── ExST assignment operators: S=, R=, REF= ──────────────
      // Per docs/codesys-reference/01-languages-and-editors.md, ExST
      // extends ST with Set (`S=`), Reset (`R=`), and reference-
      // rebind (`REF=`) assignment operators. They're a single
      // token. We recognize them only when the identifier IS
      // exactly the operator stem AND the next char is `=` (not
      // `=>` or `==`) — otherwise leave the identifier intact.
      if ((upper === "S" || upper === "R" || upper === "REF") && peek() === "=" && peek(1) !== ">" && peek(1) !== "=") {
        advance(1)
        emit("punct", startPos, startLine, startCol)
        continue
      }

      const keyword = tc && CODESYS_ONLY_KEYWORDS.has(upper) ? undefined : KEYWORD_MAP.get(upper)
      if (keyword !== undefined) {
        emit("keyword", startPos, startLine, startCol, { keyword })
      } else {
        emit("identifier", startPos, startLine, startCol)
      }
      continue
    }

    // ─── %-prefix address literal ──────────────────────────────
    // Per docs/codesys-reference/05-operands.md:
    //   %<area><size>?<position>[.<bit>]
    //   <area> ∈ {I, Q, M} ; <size> ∈ {X, B, W, D, L}
    //   <position> = digits (or `*` for incomplete; or multi-segment
    //   `2.5.7.1` for device-config-dependent forms)
    //   Examples: %IX0.0, %Q7.5, %IW215, %QB7, %MD48, %I*, %IW2.5.7.1
    // Recognized as a single `address_lit` token to keep parser
    // rules simple. We're permissive on the body content — only
    // the leading `%` + area letter is required.
    // ─── CODESYS partial access `x.%X0` / `.%B3` / `.%W1` / `.%D0` ───
    // A bit, byte, word or double-word slice of an integer, right after a `.`: ONE token, the member's name. It is
    // CODESYS's extension — TwinCAT reads the `%` as a member of its own and leaves the specifier for the statement
    // ("'%' is no component of 'd'", "';' expected instead of 'W0'", `accepts_partial_access`, both vendors 2026-09-21),
    // so on TwinCAT the `%` stays a mark and the parser says so (`parse/expression` `parsePostfix`).
    if (!tc && ch === "%" && isPartialAccessWidth(peek(1)) && isDigit(peek(2)) && lastMeaningful(tokens)?.text === ".") {
      advance(2)
      while (pos < len && isDigit(peek())) advance(1)
      emit("identifier", startPos, startLine, startCol)
      continue
    }

    if (ch === "%" && isAddressAreaChar(peek(1))) {
      advance(1) // %
      advance(1) // area letter
      // The incomplete address's `*` stands RIGHT AFTER the area: `%I*` builds, `%IW*` is "Direct address expected
      // after AT instead of %IW" — the address ends before the `*` (`lit_address_incomplete*`, both vendors 2026-10-01).
      if (peek() === "*") {
        advance(1)
        emit("address_lit", startPos, startLine, startCol)
        continue
      }
      // Optional size character (X/B/W/D/L), then the position: digits and dots. Whether the shape is one the vendor
      // takes is `literal/address`'s.
      if (isAddressSizeChar(peek())) advance(1)
      while (pos < len && (isDigit(peek()) || peek() === ".")) advance(1)
      emit("address_lit", startPos, startLine, startCol)
      continue
    }

    // ─── Backtick-quoted identifier (CODESYS extension) ────────
    // Per docs/codesys-reference/08-identifiers.md, names enclosed
    // in backticks (acute accent U+00B4 per spec; ASCII `` ` ``
    // accepted as a tolerance) can contain special characters and
    // even keywords. The backticks ARE part of the identifier —
    // `var1` and ``var1`` are distinct names.
    if (ch === "`" || ch === "´") {
      const opener = ch
      advance(1)
      while (pos < len && peek() !== opener && peek() !== "\n") {
        advance(1)
      }
      if (peek() === opener) {
        advance(1)
        emit("identifier", startPos, startLine, startCol)
      } else {
        // Unterminated — emit as unknown.
        emit("unknown", startPos, startLine, startCol)
      }
      continue
    }

    // ─── Multi-char punctuation (longest match first) ──────────
    const multi = matchMultiCharPunct()
    if (multi !== undefined) {
      advance(multi.length)
      emit("punct", startPos, startLine, startCol)
      continue
    }

    // ─── Single-char punctuation ───────────────────────────────
    if (SINGLE_CHAR_PUNCT.includes(ch)) {
      advance(1)
      emit("punct", startPos, startLine, startCol)
      continue
    }

    // ─── Unknown — single char, recover ────────────────────────
    advance(1)
    emit("unknown", startPos, startLine, startCol)
  }

  // the end-of-input sentinel, where the incremental line/col already stand — no rescan of the source
  tokens.push({ kind: "eof", text: "", span: pointSpan(pos, line, col) })

  return tokens

  // ─── Local helpers (closures over pos/line/col) ──────────────────

  /**
   * A quoted string — and whether it is WELL FORMED, which only a WSTRING's hex escape can make it not: it is FOUR hex
   * digits, and both vendors refuse a shorter run (`esc_wstring_hex_41`, `_ff`, `_pair`, `hex3`; four digits and five
   * build). THE VENDORS STOP IN DIFFERENT PLACES, and their messages quote how far they got: CODESYS reads the whole
   * literal and then refuses it (`'"$C3$A9"'`), TwinCAT ends the token at the short run (`'"$C3'`). A STRING's hex
   * escape is two digits; `$` before anything else is a named escape and takes one character.
   */
  function lexQuotedString(quote: '"' | "'"): boolean {
    let wellFormed = true
    advance(1) // opening quote
    while (pos < len) {
      const c = peek()
      if (c === "\n") break // IEC strings don't span lines (lexer recovery)
      if (c === "$") {
        advance(1)
        const esc = peek()
        if (esc === "\n" || esc === "") break
        if (isHexDigit(esc)) {
          // up to 4 hex chars — a token boundary only; the decoder (`literal/string`) reads a STRING's two
          let n = 0
          while (n < 4 && isHexDigit(peek())) {
            advance(1)
            n += 1
          }
          if (quote === '"' && n < 4) {
            wellFormed = false
            if (tc) return false
          }
        } else {
          advance(1)
        }
        continue
      }
      if (c === quote) {
        advance(1) // closing quote
        return wellFormed
      }
      advance(1)
    }
    // Unterminated — return with cursor wherever we stopped; token span reflects partial consumption.
    return wellFormed
  }

  function lexNumber(): void {
    const s = pos
    const sl = line
    const sc = col
    // CODESYS allows underscores within numeric literals (`1_000_000`).
    while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1)
    // Fractional part — but NOT if followed by another `.` (range op `..`)
    let isReal = false
    if (peek() === "." && peek(1) !== ".") {
      isReal = true
      advance(1)
      // `5.` is no REAL: both vendors refuse the token whole, "Expression expected instead of '5.'"
      // (`lit_real_no_fraction_digit`) — no exponent is read after it
      if (!isDigit(peek())) {
        emit("real_lit", s, sl, sc, MALFORMED)
        return
      }
      while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1)
    }
    // Exponent
    if (peek() === "e" || peek() === "E") {
      isReal = true
      advance(1)
      if (peek() === "+" || peek() === "-") advance(1)
      while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1)
    }
    emit(isReal ? "real_lit" : "int_lit", s, sl, sc)
  }

  /**
   * A duration's body — COMPONENTS, each a number and a unit, largest first — and whether it is well formed. Measured
   * (`lit_time_*`, `lit_ltime_*`, `cc_time_*`, both vendors 2026-09-20 and 2026-10-01):
   *   - a number starts with a digit and takes `_` as freely as an integer does (`T#1_000ms`, `T#1_ms`); a `_` after a
   *     unit ends the literal, so `T#1h_30m` is `T#1h` and then the name `_30m`;
   *   - the components are STRICTLY largest first, each unit once: `T#5s1h` and `T#1s1s` are refused whole
   *     (`lit_time_components_out_of_order`, `lit_time_component_repeated`, CODESYS 2026-10-01);
   *   - a TIME's units are d h m s ms, an LTIME's add us and ns (`µs` too); a TIME ends at a `u`, `n` or `µ`;
   *   - a number may carry a fraction, on any unit but the smallest (`T#1.5m`, `T#1.5s100ms`, `LTIME#1.5us` build);
   *     after one, `ms` in a TIME and `ns` in an LTIME are no unit: `T#1.5ms` takes `m` and the `s` left against it
   *     refuses the token, `LTIME#1.5ns` leaves its number with none;
   *   - a number with no unit (`T#1500` before `US`), a letter straight after a unit, and no component at all (`T#`
   *     before `-10ms` — a duration has no sign) are refused whole.
   */
  function lexTimeLiteralBody(long: boolean): boolean {
    let components = 0
    let lastRank = -1
    let ordered = true
    while (isDigit(peek())) {
      lexDigits()
      const fraction = peek() === "." && isDigit(peek(1))
      if (fraction) {
        advance(1)
        lexDigits()
      }
      const unit = durationUnitAt(long, fraction)
      if (unit === 0) return false
      const rank = DURATION_UNIT_RANK.indexOf(src.slice(pos, pos + unit).toLowerCase().replace("µ", "u"))
      if (rank <= lastRank) ordered = false
      lastRank = rank
      advance(unit)
      components += 1
      if (isAlpha(peek()) || peek() === "µ") return false
    }
    return components > 0 && ordered
  }

  /**
   * An integer's digits: `_` anywhere among them — doubled, trailing, leading (`1__000`, `1000_`, `INT#_5`, `T#1_ms`:
   * `lit_int_underscore_*`, `lit_int_typed_underscore_*`, `lit_time_underscore_before_unit`, CODESYS 2026-10-01).
   * Whether a DIGIT was read.
   */
  function lexDigits(): boolean {
    let any = false
    while (isDigit(peek()) || peek() === "_") {
      if (peek() !== "_") any = true
      advance(1)
    }
    return any
  }

  /** The length of the duration unit at the cursor that this literal may take here, or 0 (see `lexTimeLiteralBody`). */
  function durationUnitAt(long: boolean, afterFraction: boolean): number {
    const two = (peek() + peek(1)).toLowerCase()
    const smallest = long ? "ns" : "ms"
    const twoLetterUnits = long ? ["ms", "us", "µs", "ns"] : ["ms"]
    if (twoLetterUnits.includes(two) && !(afterFraction && two === smallest)) return 2
    const one = peek().toLowerCase()
    return one !== "" && "dhms".includes(one) ? 1 : 0
  }

  /**
   * A typed integer or bit string's body (`INT#`, `WORD#`, …) — whether it is well formed. An optional `-`, then digits,
   * then, UNSIGNED only, a `#` and that base's digits (`WORD#16#FF`, `INT#-5`: `lit_*_typed`). Both vendors refuse
   * what else there is at its first character: `INT#+5` is the token `INT#` (`lit_int_typed_plus`), `INT#-16#10` the
   * token `INT#-16` and then `#` (`lit_int_typed_negative_based`).
   */
  function lexTypedIntegerBody(): boolean {
    const signed = peek() === "-"
    if (signed) advance(1)
    const digitsStart = pos
    if (!lexDigits()) return false
    if (peek() !== "#") return true
    if (signed) return false
    const base = Number(src.slice(digitsStart, pos).replace(/_/g, ""))
    advance(1)
    return RADIXES.has(base) && lexBasedDigits(base)
  }

  /**
   * A typed BOOL's body is ONE character, and only `0` and `1` are values: `BOOL#TRUE` is the refused token `BOOL#T` and
   * then the name `RUE`, `BOOL#2` is refused whole (`lit_bool_typed_*`, both vendors).
   */
  function lexTypedBoolBody(): boolean {
    const c = peek()
    if (!isAlnum(c)) return false
    advance(1)
    return c === "0" || c === "1"
  }

  /** A based literal's digits and `_` after its `#` — whether at least one digit of the base was read. */
  function lexBasedDigits(base: number): boolean {
    let any = false
    while (pos < len && (isBaseDigit(peek(), base) || peek() === "_")) {
      if (peek() !== "_") any = true
      advance(1)
    }
    return any
  }

  function lexDateLiteralBody(): void {
    // Body: digits and `-` (YYYY-MM-DD).
    while (pos < len) {
      const c = peek()
      if (isDigit(c) || c === "-") {
        advance(1)
      } else {
        break
      }
    }
  }

  function lexTodLiteralBody(): void {
    // Body: digits, `:`, `.`.
    while (pos < len) {
      const c = peek()
      if (isDigit(c) || c === ":" || c === ".") {
        advance(1)
      } else {
        break
      }
    }
  }

  function lexDatetimeLiteralBody(): void {
    // Body: digits, `-`, `:`, `.` (DATE_AND_TIME#YYYY-MM-DD-HH:MM:SS.sss).
    while (pos < len) {
      const c = peek()
      if (isDigit(c) || c === "-" || c === ":" || c === ".") {
        advance(1)
      } else {
        break
      }
    }
  }

  function lexTypedLiteralBody(): void {
    // Body: depends on the type. We accept any non-whitespace
    // alphanumeric/sign/dot/hash sequence — the parser can
    // validate against the prefix type later. `#` is IN the set: a
    // typed BASED literal carries a second `#` (`WORD#16#1`, `DWORD#2#1010`).
    while (pos < len) {
      const c = peek()
      if (isAlnum(c) || c === "_" || c === "." || c === "+" || c === "-" || c === "#") {
        advance(1)
      } else {
        break
      }
    }
  }

  function matchMultiCharPunct(): string | undefined {
    for (const m of MULTI_CHAR_PUNCT) {
      let ok = true
      for (let i = 0; i < m.length; i++) {
        if (peek(i) !== m[i]) {
          ok = false
          break
        }
      }
      if (ok) return m
    }
    return undefined
  }
}

// ─── Char predicates (kept outside the main fn so they can inline) ───

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n"
}

/** A partial access's width letter — X, B, W or D, either case (the four measured, `operand_partial_*`). */
function isPartialAccessWidth(c: string): boolean {
  return "XBWDxbwd".includes(c) && c !== ""
}

/** The last token that is not trivia, if any. */
function lastMeaningful(tokens: readonly Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) if (!isTrivia(tokens[i]!.kind)) return tokens[i]
  return undefined
}

function isAddressAreaChar(c: string): boolean {
  return c === "I" || c === "Q" || c === "M" || c === "i" || c === "q" || c === "m"
}

function isAddressSizeChar(c: string): boolean {
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

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"
}

/** A digit of `base` (2, 8, 10 or 16), letters in either case. */
function isBaseDigit(c: string, base: number): boolean {
  if (c.length !== 1) return false
  const d = parseInt(c, 16)
  return !Number.isNaN(d) && d < base
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F")
}

function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
}

function isAlnum(c: string): boolean {
  return isAlpha(c) || isDigit(c)
}

function isIdentStart(c: string): boolean {
  return isAlpha(c) || c === "_"
}

function isIdentCont(c: string): boolean {
  return isAlnum(c) || c === "_"
}
