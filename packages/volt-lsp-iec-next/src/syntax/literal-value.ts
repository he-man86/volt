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

const UNIT_NS: Record<string, bigint> = {
  d: 86_400_000_000_000n,
  h: 3_600_000_000_000n,
  m: 60_000_000_000n,
  s: 1_000_000_000n,
  ms: 1_000_000n,
  us: 1_000n,
  µs: 1_000n,
  ns: 1n,
}

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
