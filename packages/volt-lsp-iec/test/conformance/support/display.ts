/**
 * THE VENDOR'S AND THE BACKENDS' DISPLAY FORMATS, in one place — how a value READS, which is what every comparison
 * compares (transpile-restructure 1.8.5):
 *
 *   `ideValue`      a monitoring string as CODESYS prints it (`INT#5`, `DUT_X.Running`, `TIME#1s1ns`) as the
 *                   interpreter's value — refused, never guessed, when the form is unknown;
 *   `asDisplayed`   a stored value reduced the way the IDE's display reduces it (a TOD modulo a day, a STRING decoded);
 *   `interpRender`  an interpreter value as the edge harness's Rust prints it (a REAL by its bits — a NaN's sign and
 *                   payload included — a string by unit).
 */
import { decodeStringLiteral } from "../../../src/frontend/syntax/index.js"
import { isBit, type Type } from "../../../src/frontend/types/index.js"
import type { IrValue } from "../../../src/transpile/index.js"
import { NaNBits } from "../../../src/transpile/semantics/nan.js"

/** A monitoring string as CODESYS prints it — `INT#5`, `REAL#3`, `TRUE` — as the interpreter's value. A form this
 *  does not know is refused, never guessed: a wrong parse would make both sides agree on something untrue. */
export function ideValue(raw: string, enums: ReadonlyMap<string, bigint> = new Map()): IrValue {
  if (raw === "TRUE") return true
  if (raw === "FALSE") return false
  // an enum value displays by NAME — `DUT_LANG_enum_simple.Running` — where both backends hold its number
  const enumValue = /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(raw) ? enums.get(raw.toUpperCase()) : undefined
  if (enumValue !== undefined) return enumValue
  // A STRING displays quoted and re-escaped: `'a$Tb'` holds a tab and `'x$$y'` one dollar (conformance `string_escapes`).
  // A WSTRING displays in double quotes: `"héllo"`.
  const quote = raw[0]
  if (raw.length >= 2 && (quote === "'" || quote === '"') && raw.endsWith(quote)) {
    const text = decodeStringLiteral(raw.slice(1, -1), quote === '"')
    if (text === undefined) throw new Error(`unrecognised escape in IDE value ${JSON.stringify(raw)}`)
    return text
  }
  // A date prints as `DATE#2024-2-28`, `DATE_AND_TIME#2024-2-29-0:0:0`, `TIME_OF_DAY#12:30:15.500` (L-prefixed for the
  // 64-bit ones, with up to nine fraction digits). The IR holds DATE/DT in seconds, TOD in milliseconds, L* in ns.
  const calendar = /^(L?)(DATE_AND_TIME|DATE|TIME_OF_DAY)#(.+)$/.exec(raw)
  if (calendar !== null) {
    const [, long, kind, text] = calendar as unknown as [string, string, string, string]
    const clock = (h: string, m: string, s: string, frac = ""): bigint =>
      ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n +
      BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
    let ns: bigint
    if (kind === "TIME_OF_DAY") {
      const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)!
      ns = clock(t[1]!, t[2]!, t[3]!, t[4])
    } else {
      // an instant BEFORE the epoch by less than a second prints its fraction negative: SINT_TO_LDT(-5) is
      // `LDATE_AND_TIME#1970-1-1-0:0:0.-000000005` (`xp_sint_to_ldt`, CODESYS 2026-10-03) — -5 ns
      const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(-?)(\d+))?)?$/.exec(text)
      if (d === null) throw new Error(`unrecognised date in IDE value ${JSON.stringify(raw)}`)
      ns = BigInt(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 86_400_000) * 86_400_000_000_000n
      if (d[4] !== undefined) ns += d[7] === "-" ? clock(d[4], d[5]!, d[6]!) - clock("0", "0", "0", d[8]) : clock(d[4], d[5]!, d[6]!, d[8])
    }
    if (long === "L") return ns
    return ns / (kind === "TIME_OF_DAY" ? 1_000_000n : 1_000_000_000n)
  }
  // A duration prints as its components — `TIME#49d17h2m46s796ms`, `LTIME#1s1ns` — and the IR holds TIME in
  // milliseconds and LTIME in nanoseconds.
  const duration = /^(L?TIME)#((?:\d+(?:ms|us|ns|d|h|m|s))+)$/.exec(raw)
  if (duration !== null) {
    const unit: Record<string, bigint> = {
      d: 86_400_000_000_000n,
      h: 3_600_000_000_000n,
      m: 60_000_000_000n,
      s: 1_000_000_000n,
      ms: 1_000_000n,
      us: 1_000n,
      ns: 1n,
    }
    let ns = 0n
    for (const [, count, u] of duration[2]!.matchAll(/(\d+)(ms|us|ns|d|h|m|s)/g)) ns += BigInt(count!) * unit[u!]!
    return duration[1] === "LTIME" ? ns : ns / 1_000_000n
  }
  // A NaN prints as `REAL#NaN` — the only non-numeric REAL spelling in any recording (checked across both, 2026-09-18).
  // It reached here as an unrecognised form, which is this function refusing to guess rather than a defect.
  const notANumber = /^L?REAL#NaN$/.exec(raw)
  if (notANumber !== null) return Number.NaN
  // `REAL#Infinity` and `REAL#-Infinity`. The comment above once said NaN was the only non-numeric REAL spelling in
  // any recording; `bound_real_above_max` and `realovf_multiply_to_infinity` falsified that the day they were
  // written. An infinity is an ordinary value to this vendor — see `semantics/store.ts`.
  const infinite = /^L?REAL#(-?)Infinity$/.exec(raw)
  if (infinite !== null) return infinite[1] === "-" ? -Infinity : Infinity
  const m = /^([A-Z]+)#(-?[0-9.eE+-]+)$/.exec(raw)
  if (m === null) throw new Error(`unrecognised IDE value ${JSON.stringify(raw)}`)
  const [, type, literal] = m as unknown as [string, string, string]
  if (type === "REAL") return Math.fround(Number(literal))
  if (type === "LREAL") return Number(literal)
  return BigInt(literal)
}

/**
 * A stored value as CODESYS DISPLAYS it. Its date displays lose information: a TOD shows modulo a day — TOD#12:30:15.5
 * + T#12H stores 88215500 ms but reads back `TIME_OF_DAY#0:30:15.500` — and a DATE shows no time of day. So the
 * interpreter's and emitter's values are reduced the same way before comparing; the STORED truth is compared through
 * the cases' own `*Units` variables (`TOD_TO_UDINT(…)`), which display losslessly.
 */
export function asDisplayed(raw: string, value: IrValue | NaNBits): IrValue {
  // A STRING IS STORED AS UTF-8 BYTES AND DISPLAYED AS TEXT. `strings/escapes.ts` measured both halves: `LEN('a$FFb')`
  // is 4, so the bytes are what the value IS, and the IDE reads it back as `'aÿb'`, so decoding is what the DISPLAY
  // does. We hold the bytes one JS char each (`literal-value.ts`), which is the right model and the wrong thing to
  // compare against the IDE's text — so it is decoded here, in the one place that owns the vendor's display format.
  // ...a NARROW string only. A WSTRING is UTF-16 code units, not UTF-8 bytes, and the IDE tells them apart by the
  // quote it displays: `'abc'` for a STRING, `"abc"` for a WSTRING (`prim_default_string` beside
  // `prim_default_wstring`). Decoding a WSTRING here mangled `wstring_basic` and `wstring_code_units`.
  if (typeof value === "string" && raw.startsWith("'"))
    return new TextDecoder().decode(Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff))
  // A NEGATIVE ZERO DISPLAYS AS `REAL#0`: `reinterpret_dint_as_real_edges` records rNzero `REAL#0` beside its bits bNzero
  // 16#80000000, and `tr_28_*` nz `REAL#0` beside wnz with the sign bit set — the display drops the sign the value keeps
  // (the bits are compared through those DWORDs). No recording spells `#-0`.
  if (typeof value === "number" && Object.is(value, -0)) return 0
  // A NaN displays as `REAL#NaN`, whatever its bits — which the model keeps (`NaNBits`, transpile-restructure 8.2)
  if (value instanceof NaNBits) return Number.NaN
  if (typeof value !== "bigint") return value
  const floorTo = (v: bigint, step: bigint): bigint => v - (((v % step) + step) % step)
  if (raw.startsWith("TIME_OF_DAY#")) return ((value % 86_400_000n) + 86_400_000n) % 86_400_000n
  if (raw.startsWith("LTIME_OF_DAY#"))
    return ((value % 86_400_000_000_000n) + 86_400_000_000_000n) % 86_400_000_000_000n
  if (raw.startsWith("DATE#")) return floorTo(value, 86_400n)
  // The IDE displays an LDATE's 64-bit count SIGNED: `xf_tod_to_ldate_call_once` records raw 2^64 - 2e9 beside
  // `LDATE#1969-12-31`.
  if (raw.startsWith("LDATE#")) return floorTo(BigInt.asIntN(64, value), 86_400_000_000_000n)
  // ...and an LDT's the same way: `tr_12_fmt_long_dates` records LDT#2300-01-01's raw 2^64-wrapped count as
  // `LDATE_AND_TIME#1715-6-13-0:25:26.290448384` — the same bits read as a signed i64.
  if (raw.startsWith("LDATE_AND_TIME#")) return BigInt.asIntN(64, value)
  return value
}

// ─── the edge run's renderings ───────────────────────────────────────────────────────────────────────────────

/** The kinds of value an edge run seeds and prints. */
export type Seedable = "int" | "real" | "bool" | "string"

/** The kind of value an elementary type holds, as the edge run seeds and prints it — undefined for any other type. */
export function seedable(t: Type): Seedable | undefined {
  if (t.kind !== "elementary") return undefined
  const f = t.elem.family
  if (f === "bool" || isBit(t)) return "bool"
  if (f === "int" || f === "bitstring" || f === "time" || f === "date") return "int"
  if (f === "real") return "real"
  if (f === "string") return "string"
  return undefined
}

export function interpRender(v: unknown, t: Type): string {
  const kind = seedable(t)
  if (kind === "real" && t.kind === "elementary") {
    // a NaN by its BITS, as the Rust prints it (gate 8c): both backends keep a NaN's sign and payload since step 8c, so a
    // backend that flips or drops them disagrees here (the Rust's `-x` flipped a NaN's sign before `iec_fneg32`)
    if (v instanceof NaNBits) return v.bits.toString()
    if (typeof v !== "number") return `?${String(v)}`
    return t.elem.bits === 64
      ? new BigUint64Array(new Float64Array([v]).buffer)[0]!.toString()
      : String(new Uint32Array(new Float32Array([v]).buffer)[0]!)
  }
  // by UTF-16 UNIT, as the Rust prints `units()`: a WSTRING's surrogate pair is two units, and a code-point split made it one
  if (kind === "string")
    return typeof v === "string" ? `[${Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).join(", ")}]` : `?${String(v)}`
  return String(v)
}
