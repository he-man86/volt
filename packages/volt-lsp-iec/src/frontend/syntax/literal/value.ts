/**
 * Parse a literal token's value at parse time, so const-eval and range/overflow
 * checks never re-lex the source `text` (data-model "Rebuild refinements": literals
 * carry value). The *type* is inferred later (types/infer) from `literalKind` + value.
 *
 * Conservative: anything malformed yields `undefined` (error-tolerant — a broken
 * literal must not throw). The literal Type derivation stays in layer C.
 */
import type { DurationValue, LiteralKind, LiteralValue } from "./ast.js"

export interface ParsedLiteral {
  value: LiteralValue
  prefix?: string
}

/**
 * A string literal's text with its `$` escapes decoded — only the ones measured on CODESYS (conformance `string_escapes*`,
 * `wstring_code_units`): `$T`/`$t` a tab, `$$` a dollar, `$N` and `$L` ONE line feed, `$R` CR, `$P` form feed, `$'` and `$"`
 * the quotes; two hex digits one byte in a STRING, four one code unit in a WSTRING (`$00E9` = 'é'). Any other escape — and
 * a WSTRING's named escapes, unmeasured — returns undefined, so a caller refuses rather than guesses. The ONE decoder:
 * the transpiler, the string-constant check and the assignment message used to count three different ways.
 */
export function decodeStringLiteral(raw: string, wide = false): string | undefined {
  const MEASURED: Readonly<Record<string, string>> = { T: "\t", t: "\t", N: "\n", L: "\n", R: "\r", P: "\f", $: "$", "'": "'", '"': '"' }
  let out = ""
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "$") {
      out += raw[i]
      continue
    }
    const digits = wide ? 4 : 2
    const hex = raw.slice(i + 1, i + 1 + digits)
    if (hex.length === digits && /^[0-9A-Fa-f]+$/.test(hex)) {
      const code = parseInt(hex, 16)
      // A STRING HOLDS UTF-8 BYTES, AND `$XX` NAMES A WINDOWS-1252 BYTE — not the code point U+00XX. The
      // compiler decodes it through that codepage and stores the UTF-8 encoding, so `LEN` counts the bytes.
      // Sixteen cells measured (`strings/escapes.ts`, 2026-09-19) and all sixteen follow it:
      //
      //   $41 $7E $7F              1   ASCII
      //   $81 $8D $9D              2   UNDEFINED in CP1252 — they fall back to U+0081/008D/009D
      //   $83 $8A $9F $A9 $C3 $FF  2   ƒ Š Ÿ © Ã ÿ, all below U+0800
      //   $80 $92 $99 $9B          3   € ' ™ ›, all above it
      //
      // `$80` answering THREE was the cell nothing explained while `$XX` was read as U+00XX; it is the one the
      // codepage differs on most visibly, and the four three-byte answers rule the Latin-1 reading out entirely.
      // `$C3$A9` is FOUR, not two — the pair is two CP1252 bytes, not the UTF-8 'é' it would spell.
      //
      // The bytes are kept as one JS char each, so `.length` IS the byte count and `slice` cuts on byte
      // boundaries — the same model the emitter already has in `&[u8]`.
      out += wide || code < 0x80 ? String.fromCharCode(code) : utf8Bytes(CP1252[code] ?? code)
      i += digits
      continue
    }
    if (wide) return undefined // a WSTRING's named escapes are not measured yet
    const decoded = MEASURED[raw[++i] ?? ""]
    if (decoded === undefined) return undefined
    out += decoded
  }
  return out
}

/**
 * WINDOWS-1252's own 0x80..0x9F, the only bytes where it differs from Latin-1. The five it leaves UNDEFINED
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) are absent, so the caller's `?? code` gives them U+0081 and friends — which is
 * what the compiler does with them (`esc_len_hex_81`, `_8d`, `_9d` all answer 2).
 */
const CP1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}

/** A code point's UTF-8 bytes, one JS char each — two below U+0800, three above it. */
function utf8Bytes(code: number): string {
  if (code < 0x800) return String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
  return String.fromCharCode(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
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
      // `INT#42`, `REAL#1.5`, `BOOL#TRUE`, `WORD#16#FF`
      const hash = text.indexOf("#")
      if (hash < 0) return { value: undefined }
      const prefix = text.slice(0, hash).toUpperCase()
      const body = text.slice(hash + 1)
      return { prefix, value: valueForTypedBody(prefix, body) }
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
  // CHAR/WCHAR carry a quoted char; ints otherwise.
  if (prefix === "CHAR" || prefix === "WCHAR") return stripQuotes(body)
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
