/**
 * LITERALS AS IR CONSTANTS — a literal token's value in its type's unit (durations, calendar values, typed REALs, strings)
 * and an untyped literal's type from its context. Valuation is `syntax/literal`'s, the literal's own type `types/literal`'s.
 */

import type { Lowering } from "../core/lowering.js"
import { utf8Narrow } from "../../semantics/convert.js"
import { calendarNanoseconds, decodeStringLiteral, type Expr } from "../../../frontend/syntax/index.js"
import {
  elementaryRef,
  elemOf,
  integerLiteralType,
  literalType,
  REAL_LITERAL_TYPE,
  type Type,
  UNKNOWN,
} from "../../../frontend/types/index.js"

/** A string literal's decoded text, or null (reported) when it holds an escape not measured yet. */
export function stringLiteralText(lw: Lowering, e: Extract<Expr, { kind: "literal" }>): string | null {
  const wide = e.literalKind === "wstring"
  // A character past ASCII TYPED into a STRING is what the project's "UTF-8 Encoding for STRING" makes it: on, its UTF-8
  // bytes (`slit_*`: 'größe' is 7 bytes, a STRING(3) of it 'gr' and C3); off, its Latin-1 byte, '?' for each UTF-16 unit
  // past U+00FF (CODESYS 3.5.21.40, commit 1d71f12416: 'größe' LEN 5, 'a计b' a ? b). Encoded before the `$` escapes are
  // read, so an escape stays the one byte it names. A WSTRING holds UTF-16 code units: "héllo" into a WSTRING(3) is "hél"
  // (`wstring_code_units`), a character beyond the BMP its two surrogate units (`wsu_widen_four_byte`).
  const raw = e.value as string
  const encoding = lw.shared.encoding
  if (!wide && /[^\x00-\x7f]/.test(raw) && encoding === undefined) {
    lw.bail("string-encoding-unstated", `${e.text} holds a character past ASCII, whose bytes the project's "UTF-8 Encoding for STRING" decides — no .projectsettings states it`, e.span)
    return null
  }
  const decoded = decodeStringLiteral(wide ? raw : encoding === "utf8" ? utf8Narrow(raw) : latin1Literal(raw), wide)
  if (decoded === undefined) {
    lw.bail("string-escape", `${e.text} holds a \`$\` escape that is not measured yet`, e.span)
    return null
  }
  return decoded
}

/** A STRING literal's text with "UTF-8 Encoding for STRING" off: each UTF-16 unit up to U+00FF is its Latin-1 byte, any
 *  other '?' — a surrogate pair two of them ('a😀b' is a ? ? b). ASCII is itself. */
function latin1Literal(raw: string): string {
  let out = ""
  for (let i = 0; i < raw.length; i++) out += raw.charCodeAt(i) <= 0xff ? raw[i] : "?"
  return out
}

/**
 * A duration literal's value in its type's UNIT. Measured (conformance `time_*`, `ltime_basic`): TIME is 32-bit
 * MILLISECONDS — T#49D17H2M47S295MS plus 1 ms wraps to 0 — and LTIME 64-bit NANOSECONDS. The AST normalizes both to
 * nanoseconds under one `literalKind: "time"`, so the prefix decides which. This used to type every duration TIME
 * and hold it in nanoseconds: a recalled design note, while `types/elementary` already said TIME is 32 bits.
 */
export function durationOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const v = e.value
  if (e.literalKind !== "time" || typeof v !== "object" || v === null || !("ns" in v)) return undefined
  return inTicks(v.ns, literalType(e))
}

/** The literal kinds `durationOf` / `calendarOf` / `typedRealOf` are responsible for.
 *
 *  A literal of one of these kinds whose conversion returns `undefined` must be REPORTED, never handed on: the
 *  next branch in both call sites tests `typeof value === "string"`, and a date literal's AST value IS the
 *  string `"300000-01-01"`, so a failed conversion silently became a STRING constant. That is the other half of
 *  the totality contract — "never a throw AND never an invented meaning" — and it is the half that does not
 *  announce itself. */
export const TEMPORAL_LITERAL_KINDS: ReadonlySet<string> = new Set(["date", "datetime", "tod", "duration"])

/**
 * A date, date-and-time or time-of-day literal's value in its type's UNIT. Measured (conformance `date_*`,
 * `ldate_ltod_ldt`): DATE and DT count SECONDS since 1970-01-01 in 32 bits (DATE_TO_UDINT(D#1970-01-02) is 86400, not
 * 1; DT#2106-02-07-06:28:15 plus a second wraps to the epoch), TOD counts MILLISECONDS since midnight in 32 bits, and
 * LDATE / LDT / LTOD count NANOSECONDS in 64. The AST keeps the text (`"1970-01-02"`) and the prefix decides the type.
 */
export function calendarOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const text = e.value
  if (typeof text !== "string" || !["date", "datetime", "tod"].includes(e.literalKind)) return undefined
  const ns = calendarNanoseconds(e.literalKind as "date" | "datetime" | "tod", text)
  return ns === undefined ? undefined : inTicks(ns, literalType(e))
}

/**
 * A REAL- or LREAL-prefixed literal's value in its prefix type. The prefix decides, not the context: `lr := REAL#0.1`
 * stores float32's 0.1 (0.10000000149011612), where `LREAL#0.1` and an untyped `0.1` store float64's (conformance
 * `typed_literal_real_prefix`). Lowering used to type every real literal by its context. An INTEGER prefix changed
 * nothing measured — `INT#30000 + INT#30000` still folds at full width (`typed_literal_constant_fold`) — so it keeps the
 * untyped path.
 */
export function typedRealOf(e: Extract<Expr, { kind: "literal" }>): { value: number; type: Type } | undefined {
  if (e.literalKind !== "typed" || typeof e.value !== "number") return undefined
  const type = elementaryRef(e.prefix ?? "")
  const real = elemOf(type)
  if (real?.family !== "real") return undefined
  return { value: real.bits === 32 ? Math.fround(e.value) : e.value, type }
}

/** A nanosecond count in its type's ticks (`types/elementary` `tickNs`), with that type — the literal's own
 *  (`types/literalType`: its prefix decides). */
function inTicks(ns: bigint, type: Type): { value: bigint; type: Type } | undefined {
  const tick = elemOf(type)?.tickNs
  return tick === undefined ? undefined : { value: ns / tick, type }
}

/** An untyped literal's type: the context's, or the narrowest that holds the value (its OWN type is `types/literalType`). */
export function contextLiteralType(e: Extract<Expr, { kind: "literal" }>, expected?: Type): Type {
  const want = elemOf(expected ?? UNKNOWN)
  const v = e.value
  if (v === undefined) return UNKNOWN
  if (typeof v === "boolean") return elementaryRef("BOOL")
  // (strings and durations never reach here: `expr` lowers both before asking for a literal's type)
  if (typeof v === "string" || typeof v === "object") return UNKNOWN
  if (typeof v === "number") return want?.family === "real" ? expected! : elementaryRef(REAL_LITERAL_TYPE)
  // An integer literal: honour a numeric context (REAL included — `x : REAL := 1;` is legal), else narrowest.
  if (want !== undefined && want.rank !== undefined) return expected!
  // the narrowest type CODESYS gives the literal — `types/`'s, not a second list here (this one used to skip the unsigned)
  const t = integerLiteralType(v)
  return t === undefined ? UNKNOWN : elementaryRef(t.name)
}
