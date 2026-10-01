/**
 * A LITERAL'S VALUE, read at parse time — so const-eval and range/overflow checks never re-lex the source `text`. The
 * literal's TYPE is the type layer's (`types/literal`), from `literalKind`, the prefix and the value. A string's escapes
 * are `string.ts`'s; a date's calendar value is `calendar.ts`'s.
 *
 * Conservative: anything malformed yields `undefined` (error-tolerant — a broken literal must not throw).
 */
import type { DurationValue, LiteralKind, LiteralValue } from "../ast/nodes.js"
import { QUOTED_LITERAL_PREFIXES, TYPED_PREFIXES } from "../lex/vocabulary.js"
import { decodeUtf8Literal } from "./string.js"

export interface ParsedLiteral {
  value: LiteralValue
  prefix?: string
}

export function parseLiteralValue(kind: LiteralKind, text: string): ParsedLiteral {
  switch (kind) {
    case "int":
      return { value: parseIntLiteral(text) }
    case "real":
      return { value: parseRealLiteral(text) }
    case "bool":
      return { value: /^true$/i.test(text) }
    case "string":
    case "wstring":
      return { value: stripQuotes(text) }
    case "time":
      return { value: parseDuration(text) }
    case "typed": {
      // `INT#42`, `REAL#1.5`, `BOOL#TRUE`, `WORD#16#FF`; `UCHAR#'A'`, `UTF8#'…'`; a component pair (`typedLiteralForm`)
      const prefix = text.slice(0, text.indexOf("#")).toUpperCase()
      const form = typedLiteralForm(text)
      switch (form.kind) {
        case "typed":
          return { prefix, value: valueForTypedBody(form.prefix, form.body) }
        case "char":
          return { prefix, value: form.code }
        case "utf8":
        case "text":
          return { prefix, value: form.raw }
        case "component":
          return { prefix, value: undefined }
      }
    }
    case "date":
    case "tod":
    case "datetime": {
      // Full calendar valuation is deferred (no check needs it yet). Keep the body
      // string as the value and the prefix (`DT`, `TOD`, …) for rendering.
      const hash = text.indexOf("#")
      if (hash < 0) return { value: undefined }
      return { prefix: text.slice(0, hash).toUpperCase(), value: text.slice(hash + 1) }
    }
    case "address":
      // `%IX0.0` — opaque hardware address; the whole text is the identity.
      return { prefix: text, value: undefined }
  }
}

/**
 * WHAT A `<word>#<operand>` TOKEN IS (S10–S13) — the lexer reads every such pair as one `typed_lit`, and CODESYS gives
 * it one of five meanings (measured 2026-10-01, `lit_*`):
 *
 *   typed       a literal prefix (`TYPED_PREFIXES`): `INT#5`, `REAL#1.5`, `BOOL#1`, `WORD#16#FF`
 *   char        `UCHAR#'A'` — exactly `UCHAR`, one character once its escapes are decoded — its code: `UCHAR#'€'` runs
 *               as UDINT#8364, `UCHAR#'$41'` as UDINT#65
 *   utf8        `UTF8#'…'` — exactly `UTF8` — a STRING of the text's UTF-8 bytes (`literal/string` `decodeUtf8Literal`)
 *   text        a `UCHAR#'…'`/`UTF8#'…'` token that is neither (another case, not one character): a STRING of the
 *               TOKEN'S OWN TEXT less its first and last character — `UCHAR#'AB'` runs as 'CHAR#$'AB', `utf8#'a'` as
 *               'tf8#$'a', `UCHAR#'$41$42'` is STRING(8). Raw: its escapes are decoded where a STRING's are.
 *   component   any other pair — `CHAR#'A'`, `WCHAR#"A"`, `CHAR#65`, `UCHAR#"A"`, `XYZ#'abc'`, `E_Mode#Running` — which
 *               CODESYS reads as a component of the word: "''A'' is no component of 'CHAR'", word and operand as
 *               written; of an ENUM type, a value of unknown type ("Unknown type: 'E_Mode#Running'", IEC's typed enum
 *               literal is not supported)
 *
 * A character is counted as CODESYS counts it, once the escapes are decoded — and an escape names a WINDOWS-1252 byte,
 * as in a STRING: `UCHAR#'$C4'` runs as UDINT#196 (`Ä`), `UCHAR#'$80'` as UDINT#8364 (`€`, not the byte 128)
 * (`lit_uchar_high_escape`, `lit_uchar_escape_80`, CODESYS 2026-10-01). The decoder keeps a STRING as its UTF-8
 * bytes, so the characters are read back from those bytes, never counted off the byte string itself.
 */
export type TypedLiteralForm =
  | { kind: "typed"; prefix: string; body: string }
  | { kind: "char"; code: bigint }
  | { kind: "utf8"; raw: string }
  | { kind: "text"; raw: string }
  | { kind: "component"; prefix: string; operand: string }

export function typedLiteralForm(text: string): TypedLiteralForm {
  const hash = text.indexOf("#")
  if (hash < 0) throw new Error(`'${text}' is not a typed literal`)
  const prefix = text.slice(0, hash)
  const upper = prefix.toUpperCase()
  const operand = text.slice(hash + 1)
  if (TYPED_PREFIXES.has(upper)) return { kind: "typed", prefix: upper, body: operand }
  if (!QUOTED_LITERAL_PREFIXES.has(upper) || !operand.startsWith("'")) return { kind: "component", prefix, operand }
  const raw = stripQuotes(operand)
  if (prefix === "UTF8") return { kind: "utf8", raw }
  const bytes = prefix === "UCHAR" ? decodeUtf8Literal(raw) : undefined
  const chars = bytes === undefined ? [] : [...UTF8.decode(Uint8Array.from(bytes, (b) => b.charCodeAt(0)))]
  if (chars.length === 1) return { kind: "char", code: BigInt(chars[0].codePointAt(0)!) }
  return { kind: "text", raw: text.slice(1, -1) }
}

/** Strict: a byte string the decoder produced is UTF-8 by construction, and one that is not is a decoder bug. */
const UTF8 = new TextDecoder("utf-8", { fatal: true })

function stripQuotes(text: string): string {
  if (text.length >= 2) {
    const q = text[0]
    if ((q === "'" || q === '"') && text[text.length - 1] === q) return text.slice(1, -1)
  }
  return text
}

function parseIntLiteral(text: string): bigint | undefined {
  const t = text.replace(/_/g, "")
  const hash = t.indexOf("#")
  try {
    if (hash < 0) return BigInt(t)
    const base = Number(t.slice(0, hash))
    const digits = t.slice(hash + 1)
    if (base === 16) return BigInt(`0x${digits}`)
    if (base === 8) return BigInt(`0o${digits}`)
    if (base === 2) return BigInt(`0b${digits}`)
    // Uncommon base — fold digit by digit.
    let acc = 0n
    const b = BigInt(base)
    for (const ch of digits.toLowerCase()) {
      const d = parseInt(ch, base)
      if (Number.isNaN(d)) return undefined
      acc = acc * b + BigInt(d)
    }
    return acc
  } catch {
    return undefined
  }
}

function parseRealLiteral(text: string): number | undefined {
  const n = Number(text.replace(/_/g, ""))
  return Number.isNaN(n) ? undefined : n
}

function valueForTypedBody(prefix: string, body: string): LiteralValue {
  if (prefix === "REAL" || prefix === "LREAL") return parseRealLiteral(body)
  if (prefix === "BOOL") {
    if (/^true$/i.test(body)) return true
    if (/^false$/i.test(body)) return false
    // `BOOL#1` / `BOOL#0`
    return body === "0" ? false : body === "1" ? true : undefined
  }
  return parseIntLiteral(body)
}

/**
 * THE DURATION LADDER — every unit a TIME or LTIME names, LARGEST first, in nanoseconds.
 *
 * <p>One home, and it sits in `syntax` because that is the lowest layer that needs it: the literal PARSER reads
 * it here and the transpiler's PRINTERS read it downward (`ir/values`, where `timeText` and `ltimeText` each
 * carried their own copy — one scaled to milliseconds, one to nanoseconds, agreeing by hand).</p>
 *
 * <p>The Rust prelude carries a fourth copy as source TEXT and cannot import this; that one is a mirror, and the
 * measurements it mirrors are in `conversions/to-string-format.ts`.</p>
 */
export const DURATION_UNITS_NS: readonly (readonly [unit: string, ns: bigint])[] = [
  ["d", 86_400_000_000_000n],
  ["h", 3_600_000_000_000n],
  ["m", 60_000_000_000n],
  ["s", 1_000_000_000n],
  ["ms", 1_000_000n],
  ["us", 1_000n],
  ["ns", 1n],
]

/** …as a lookup, with the `µs` spelling a source file may use for microseconds. */
const UNIT_NS: Record<string, bigint> = { ...Object.fromEntries(DURATION_UNITS_NS), "µs": 1_000n }

// ms/us/ns before the single-letter m/s so the greedy alternation matches them first.
const DURATION_RE = /(\d+(?:\.\d+)?)(ms|us|µs|ns|d|h|m|s)/gi

/** `T#10ms`, `TIME#1h30m`, `LTIME#1.5s`, `T#-10ms` → nanoseconds. */
function parseDuration(text: string): DurationValue | undefined {
  const hash = text.indexOf("#")
  if (hash < 0) return undefined
  let body = text.slice(hash + 1).replace(/_/g, "")
  let sign = 1n
  if (body.startsWith("-")) {
    sign = -1n
    body = body.slice(1)
  }
  let total = 0n
  let matched = false
  for (const m of body.matchAll(DURATION_RE)) {
    matched = true
    const num = Number(m[1])
    const unit = m[2].toLowerCase()
    const perUnit = UNIT_NS[unit === "µs" ? "us" : unit]
    if (perUnit === undefined) return undefined
    // Fractional components (`1.5s`) — carry through as ns via number, then round.
    total += Number.isInteger(num) ? BigInt(num) * perUnit : BigInt(Math.round(num * Number(perUnit)))
  }
  if (!matched) return undefined
  return { kind: "duration", ns: sign * total }
}
