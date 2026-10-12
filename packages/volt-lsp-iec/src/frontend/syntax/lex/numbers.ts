/**
 * THE NUMBER SCANNER — integers, based integers (`16#FF`), reals, and the bodies of the number-shaped literals: a
 * duration's components (`T#1h30m`, read after `words.ts` has taken the prefix), and the digit runs a typed integer
 * takes.
 */
import { isAlpha, isBaseDigit, isDigit } from "./chars.js"
import { MALFORMED, RADIXES, type Scanner } from "./scanner.js"

/** A duration's units, largest first — a literal's components must run strictly down this list (`lexTimeLiteralBody`). */
const DURATION_UNIT_RANK = ["d", "h", "m", "s", "ms", "us", "ns"]

/**
 * Scans one number at the cursor, if one starts there.
 *
 * ─── Number-with-radix `16#FF`, `8#77`, `2#1010` ───────────
 * `_` separates digits anywhere in the run — doubled, trailing, right after the base's `#` (`lit_int_underscore*`
 * all build, the values read with the separators dropped). A BASE is 2, 8, 10 or 16 (`lit_invalid_base_{3,4,12}`
 * refuse the `<n>#` token whole, `lit_invalid_base_10` builds) and takes only its own digits: `2#102` is `2#10` and
 * then `2`, `16#FG` is `16#F` and then `G` (`lit_invalid_digit_*`) — the vendor's lexer ends the literal there.
 */
export function scanNumber(s: Scanner): boolean {
  if (!isDigit(s.peek())) return false
  while (s.more && (isDigit(s.peek()) || s.peek() === "_")) s.advance(1)
  if (s.peek() === "#") {
    const base = Number(s.text().replace(/_/g, ""))
    s.advance(1)
    if (!RADIXES.has(base)) {
      s.emit("int_lit", MALFORMED)
      return true
    }
    const digits = lexBasedDigits(s, base)
    s.emit("int_lit", digits ? undefined : MALFORMED)
    return true
  }
  // Otherwise rewind and let the real-number path handle
  // fractional/exponent forms.
  s.rewind()
  lexNumber(s)
  return true
}

function lexNumber(s: Scanner): void {
  // CODESYS allows underscores within numeric literals (`1_000_000`).
  while (s.more && (isDigit(s.peek()) || s.peek() === "_")) s.advance(1)
  // Fractional part — but NOT if followed by another `.` (range op `..`)
  let isReal = false
  if (s.peek() === "." && s.peek(1) !== ".") {
    isReal = true
    s.advance(1)
    // `5.` is no REAL: both vendors refuse the token whole, "Expression expected instead of '5.'"
    // (`lit_real_no_fraction_digit`) — no exponent is read after it
    if (!isDigit(s.peek())) {
      s.emit("real_lit", MALFORMED)
      return
    }
    while (s.more && (isDigit(s.peek()) || s.peek() === "_")) s.advance(1)
  }
  // Exponent
  if (s.peek() === "e" || s.peek() === "E") {
    isReal = true
    s.advance(1)
    if (s.peek() === "+" || s.peek() === "-") s.advance(1)
    while (s.more && (isDigit(s.peek()) || s.peek() === "_")) s.advance(1)
  }
  s.emit(isReal ? "real_lit" : "int_lit")
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
export function lexTimeLiteralBody(s: Scanner, long: boolean): boolean {
  let components = 0
  let lastRank = -1
  let ordered = true
  while (isDigit(s.peek())) {
    lexDigits(s)
    const fraction = s.peek() === "." && isDigit(s.peek(1))
    if (fraction) {
      s.advance(1)
      lexDigits(s)
    }
    const unit = durationUnitAt(s, long, fraction)
    if (unit === 0) return false
    const rank = DURATION_UNIT_RANK.indexOf(s.src.slice(s.pos, s.pos + unit).toLowerCase().replace("µ", "u"))
    if (rank <= lastRank) ordered = false
    lastRank = rank
    s.advance(unit)
    components += 1
    if (isAlpha(s.peek()) || s.peek() === "µ") return false
  }
  return components > 0 && ordered
}

/**
 * An integer's digits: `_` anywhere among them — doubled, trailing, leading (`1__000`, `1000_`, `INT#_5`, `T#1_ms`:
 * `lit_int_underscore_*`, `lit_int_typed_underscore_*`, `lit_time_underscore_before_unit`, CODESYS 2026-10-01).
 * Whether a DIGIT was read.
 */
export function lexDigits(s: Scanner): boolean {
  let any = false
  while (isDigit(s.peek()) || s.peek() === "_") {
    if (s.peek() !== "_") any = true
    s.advance(1)
  }
  return any
}

/** The length of the duration unit at the cursor that this literal may take here, or 0 (see `lexTimeLiteralBody`). */
function durationUnitAt(s: Scanner, long: boolean, afterFraction: boolean): number {
  const two = (s.peek() + s.peek(1)).toLowerCase()
  const smallest = long ? "ns" : "ms"
  const twoLetterUnits = long ? ["ms", "us", "µs", "ns"] : ["ms"]
  if (twoLetterUnits.includes(two) && !(afterFraction && two === smallest)) return 2
  const one = s.peek().toLowerCase()
  return one !== "" && "dhms".includes(one) ? 1 : 0
}

/** A based literal's digits and `_` after its `#` — whether at least one digit of the base was read. */
export function lexBasedDigits(s: Scanner, base: number): boolean {
  let any = false
  while (s.more && (isBaseDigit(s.peek(), base) || s.peek() === "_")) {
    if (s.peek() !== "_") any = true
    s.advance(1)
  }
  return any
}
