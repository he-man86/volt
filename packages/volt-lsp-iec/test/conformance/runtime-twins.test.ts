/**
 * THE TWIN HARNESS (design.md P3, §8; transpile-restructure 1.5.15). `semantics/` is the value model the interpreter runs;
 * `emit/rust/runtime/` is its Rust mirror. Each mirrored model's case table (`semantics/<model>.cases.ts`) is run against
 * the TypeScript by `semantics/<model>.test.ts` — and here against the Rust: one program per table, the runtime snippet
 * plus a generated `main` that prints every case, built with `rustc`, each printed line required to equal the case's
 * `expected`. A case that names a recording is also held to that recording, so a table cannot drift from the oracle.
 *
 * Every case passes today; a divergence found later is marked an expected failure naming its RC, not removed.
 */
import { describe, expect, test } from "bun:test"
import type { Case } from "../../src/transpile/semantics/cases.js"
import {
  EXPT_CASES,
  INT_TO_REAL_CASES,
  REAL_TO_INT_CASES,
  SELECT_CASES,
  SQRT_CASES,
  TRUNC_CASES,
} from "../../src/transpile/semantics/numeric.cases.js"
import {
  LONG_CALENDAR_TEXT_CASES,
  LREAL_TEXT_CASES,
  LREAL_TIE_CASES,
  LTIME_TEXT_CASES,
  type LongCalendarInput,
} from "../../src/transpile/semantics/text.cases.js"
import { PARSE_INT_CASES, WIDE_PARSE_INT_CASES } from "../../src/transpile/semantics/parse.cases.js"
import { RUNS } from "./support/recordings.js"
import { STRING_CASE_LIST, shown, MEMORY_CASE_LIST, NAN_CASE_LIST } from "./support/runtime-twins.js"

/** The recorded value a case names, refused by name when the recording does not hold it. */
function recorded(c: Case<unknown, unknown>): string {
  const rec = c.recording
  if (rec === undefined) throw new Error(`${c.name} names no recording`)
  const values = RUNS[rec.fixture]?.values
  if (values === undefined) throw new Error(`${c.name}: no recording of ${rec.fixture}`)
  const value = values[rec.variable]
  if (value === undefined) throw new Error(`${c.name}: ${rec.fixture} recorded no ${rec.variable}`)
  return value
}

/** The recorded input a case names (`recording.input`), refused by name when the recording does not hold it. */
function recordedInput(c: Case<unknown, unknown>): string {
  const rec = c.recording
  if (rec === undefined) throw new Error(`${c.name} names no recording`)
  const value = RUNS[rec.fixture]?.values?.[rec.input]
  if (value === undefined) throw new Error(`${c.name}: ${rec.fixture} recorded no ${rec.input}`)
  return value
}

const NS_PER_DAY = 86_400_000_000_000n

/** A long-calendar value as CODESYS's monitoring shows it (the recording's `inst.v<i>`): the u64 read SIGNED (past 2262 it
 *  is before 1970), the date of the day it falls in (floored — the monitor shows LDATE `1715-6-13` where LDATE_TO_STRING
 *  prints `1715-06-14`), unpadded fields, nine fraction digits only when the fraction is not zero. */
function monitored(input: LongCalendarInput): string {
  const signed = BigInt.asIntN(64, input.ns)
  const rem = ((signed % NS_PER_DAY) + NS_PER_DAY) % NS_PER_DAY
  const days = (signed - rem) / NS_PER_DAY
  const d = new Date(Number(days) * 86_400_000)
  const date = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
  const secs = rem / 1_000_000_000n
  const frac = rem % 1_000_000_000n
  const time = `${secs / 3600n}:${(secs / 60n) % 60n}:${secs % 60n}${frac === 0n ? "" : `.${frac.toString().padStart(9, "0")}`}`
  if (input.name === "LDATE") return `LDATE#${date}`
  if (input.name === "LTOD") return `LTIME_OF_DAY#${time}`
  return `LDATE_AND_TIME#${date}-${time}`
}

/** `<TYPE>#<text>` split at the first `#`; anything else is refused by name. */
function typed(text: string | undefined, where: string): { type: string; text: string } {
  const at = text?.indexOf("#") ?? -1
  if (text === undefined || at < 0) throw new Error(`${where}: no typed recorded value (${text})`)
  return { type: text.slice(0, at), text: text.slice(at + 1) }
}

/** A recorded STRING (`'text'`) as its text. */
function quoted(text: string, where: string): string {
  if (!text.startsWith("'") || !text.endsWith("'")) throw new Error(`${where}: not a recorded STRING (${text})`)
  return text.slice(1, -1)
}

/** A recorded value a string case names, refused by name when the recording does not hold it. */
function recordedAt(fixture: string, path: string): string {
  const value = RUNS[fixture]?.values?.[path]
  if (value === undefined) throw new Error(`${fixture} recorded no ${path}`)
  return value
}

/** A recording's value in `shown`'s terms: a BYTE/WORD/INT as its number, a STRING ('…') or WSTRING ("…") as its text. */
function asShown(value: string, where: string): string {
  if (/^["']/.test(value)) {
    if (value.at(-1) !== value[0]) throw new Error(`${where}: not a recorded string (${value})`)
    return value.slice(1, -1)
  }
  return typed(value, where).text
}

describe("runtime twins — the case tables hold their recordings", () => {
  test("every byte-image case that names a recording reads what CODESYS recorded, from the input it ran", () => {
    const named = MEMORY_CASE_LIST.filter((c) => c.recording !== undefined)
    expect(named.length).toBeGreaterThan(0)
    const got = named.map((c) => {
      const out = typed(recorded(c), c.name)
      const input = typed(recordedInput(c), c.name)
      return `${c.name}: ${BigInt(out.text).toString(16)} from ${input.text}`
    })
    expect(got).toEqual(named.map((c) => `${c.name}: ${c.expected} from ${String(c.input.stores[0]!.value)}`))
  })

  test("every STRING and WSTRING -> integer case is the recorded cell of the fixture it names, from the text it parsed", () => {
    const bad: string[] = []
    for (const c of [...PARSE_INT_CASES, ...WIDE_PARSE_INT_CASES]) {
      const rec = c.recording!
      const out = typed(recorded(c), `${rec.fixture} ${rec.variable}`)
      if (out.type !== c.input.to || BigInt(out.text) !== c.expected) bad.push(`${c.name}: recorded ${recorded(c)}, case ${c.input.to}#${c.expected}`)
      // the monitor shows a STRING as '…' and a WSTRING as "…", a tab as $T
      const text = recordedInput(c).replace(/^['"]|['"]$/g, "").replace(/\$T/g, "\t")
      if (text !== c.input.text) bad.push(`${c.name}: recorded ${rec.input} ${recordedInput(c)}, case ${JSON.stringify(c.input.text)}`)
    }
    expect(bad).toEqual([])
  })

  test("every REAL -> integer case is the recorded cell of the fixture it names", () => {
    expect(REAL_TO_INT_CASES).toHaveLength(192)
    const bad: string[] = []
    for (const c of REAL_TO_INT_CASES) {
      const rec = c.recording!
      const out = typed(recorded(c), `${rec.fixture} ${rec.variable}`)
      if (out.type !== c.input.to || BigInt(out.text) !== c.expected) bad.push(`${c.name}: recorded ${recorded(c)}, case ${c.input.to}#${c.expected}`)
      const v = typed(recordedInput(c), `${rec.fixture} ${rec.input}`)
      const value = c.input.from === "REAL" ? Math.fround(Number(v.text)) : Number(v.text)
      if (!Object.is(value, c.input.value)) bad.push(`${c.name}: recorded v ${v.type}#${v.text}, case ${c.input.value}`)
    }
    expect(bad).toEqual([])
  })

  test("every compare-select case is the recorded bits of the fixture it names, from the NaN or -0 it ran on", () => {
    const got = SELECT_CASES.map((c) => {
      const out = typed(recorded(c), c.name)
      const input = typed(recordedInput(c), c.name)
      return `${c.name}: ${out.text} from ${input.text}`
    })
    const ran = (c: (typeof SELECT_CASES)[number]): string => {
      const real = c.input.type === "REAL"
      return c.recording!.input === "wn" ? (real ? "4290772992" : "18444492273895866368") : real ? "2147483648" : "9223372036854775808"
    }
    expect(got).toEqual(SELECT_CASES.map((c) => `${c.name}: ${c.expected} from ${ran(c)}`))
  })

  test("every REAL SQRT case is the recorded cell of the fixture it names, from the REAL it ran", () => {
    const number = (text: string, where: string): number => Number(typed(text, where).text)
    const got = SQRT_CASES.map((c) => `${c.name}: ${Math.fround(number(recorded(c), c.name))} from ${number(recordedInput(c), c.name)}`)
    expect(got).toEqual(SQRT_CASES.map((c) => `${c.name}: ${c.expected} from ${c.input.value}`))
  })

  test("every EXPT case is the recorded cell of the fixture it names — its result, or the task stopping — from the exponent it ran", () => {
    const got = EXPT_CASES.map((c) => {
      const rec = RUNS[c.recording!.fixture]
      if (c.expected === "stop") return `${c.name}: ${rec?.error}`
      const res = typed(recorded(c), c.name)
      const e = typed(recordedInput(c), c.name)
      return `${c.name}: ${res.type}#${Number(res.text)} from ${Number(e.text)}`
    })
    expect(got).toEqual(
      EXPT_CASES.map((c) => `${c.name}: ${c.expected === "stop" ? "The operation has timed out." : `${c.input.type}#${c.expected} from ${c.input.y}`}`),
    )
  })

  test("every TRUNC case is the recorded DINT cell of the fixture it names, from the value it ran", () => {
    const got = TRUNC_CASES.map((c) => {
      const out = typed(recorded(c), c.name)
      const v = typed(recordedInput(c), c.name)
      const value = c.input.from === "REAL" ? Math.fround(Number(v.text)) : Number(v.text)
      return `${c.name}: ${out.type}#${out.text} from ${v.type}#${value}`
    })
    expect(got).toEqual(TRUNC_CASES.map((c) => `${c.name}: DINT#${c.expected} from ${c.input.from}#${c.input.value}`))
  })

  test("every NaN case is the recorded bits of the fixture it names, from the NaN operand it ran on (8.2)", () => {
    const bad: string[] = []
    for (const c of NAN_CASE_LIST) {
      const out = typed(recorded(c), c.name)
      if (BigInt(out.text) !== c.expected) bad.push(`${c.name}: recorded ${recorded(c)}, case ${c.expected.toString(16)}`)
      // the operand: a NaN's bits (a DWORD or LWORD the fixture loads it from), or the plain value beside it (`one`, `two`:
      // LN(zero - one) runs on its negation)
      const input = typed(recordedInput(c), c.name)
      const word = input.type === "DWORD" || input.type === "LWORD"
      const bits = (v: number, real: boolean): bigint => {
        const view = new DataView(new ArrayBuffer(8))
        if (real) view.setFloat32(0, v)
        else view.setFloat64(0, v)
        return real ? BigInt(view.getUint32(0)) : view.getBigUint64(0)
      }
      const ran = word ? [BigInt(input.text)] : [bits(Number(input.text), input.type === "REAL"), bits(-Number(input.text), input.type === "REAL")]
      if (!ran.some((b) => c.input.args.includes(b))) bad.push(`${c.name}: recorded ${c.recording!.input} ${recordedInput(c)}, operands ${c.input.args.map((a) => a.toString(16))}`)
    }
    expect(bad).toEqual([])
  })

  test("every 64-bit integer -> REAL case is the recorded cell, from the integer it ran", () => {
    const got = INT_TO_REAL_CASES.map((c) => {
      const out = typed(recorded(c), c.name)
      const input = typed(recordedInput(c), c.name)
      return `${c.name}: ${out.type}#${Math.fround(Number(out.text))} from ${input.type}#${input.text}`
    })
    expect(got).toEqual(INT_TO_REAL_CASES.map((c) => `${c.name}: REAL#${c.expected} from ${c.input.from}#${c.input.value}`))
  })

  test("every text case names a recording — but the -0 cell, which no fixture ran", () => {
    const lreal = Object.values(LREAL_TEXT_CASES).flat()
    expect(lreal).toHaveLength(25)
    const unrecorded = [...lreal, ...LREAL_TIE_CASES, ...LONG_CALENDAR_TEXT_CASES, ...LTIME_TEXT_CASES].filter((c) => c.recording === undefined)
    expect(unrecorded.map((c) => c.name)).toEqual(["-0"])
  })

  test("every text case that names a recording prints what CODESYS recorded", () => {
    const named = [...Object.values(LREAL_TEXT_CASES).flat(), ...LREAL_TIE_CASES, ...LONG_CALENDAR_TEXT_CASES, ...LTIME_TEXT_CASES].filter(
      (c) => c.recording !== undefined,
    )
    expect(named.map((c) => `${c.name}: ${quoted(recorded(c), c.name)}`)).toEqual(named.map((c) => `${c.name}: ${c.expected}`))
  })

  test("every LREAL text case's input is the value its fixture ran", () => {
    const named = [...Object.values(LREAL_TEXT_CASES).flat(), ...LREAL_TIE_CASES].filter((c) => c.recording !== undefined)
    const bad: string[] = []
    for (const c of named) {
      const v = typed(recordedInput(c), `${c.name} input`)
      if (v.type !== "LREAL" || !Object.is(Number(v.text), c.input)) bad.push(`${c.name}: recorded ${v.type}#${v.text}, case ${c.input}`)
    }
    expect(bad).toEqual([])
  })

  test("every string case shows what its fixture recorded — each unit dumped through s[i], each string and length", () => {
    const seen = STRING_CASE_LIST.flatMap((c) => c.seen.map((v) => ({ c, v })))
    expect(seen.length).toBeGreaterThan(300)
    const got = seen.map(({ c, v }) => `${c.name} ${v.path}: ${asShown(recordedAt(c.fixture, v.path), `${c.fixture} ${v.path}`)}`)
    expect(got).toEqual(seen.map(({ c, v }) => `${c.name} ${v.path}: ${shown(c.expected, v)}`))
  })

  test("every LTIME text case's input is the value its fixture ran", () => {
    const UNIT: Readonly<Record<string, bigint>> = {
      d: 86_400_000_000_000n,
      h: 3_600_000_000_000n,
      m: 60_000_000_000n,
      s: 1_000_000_000n,
      ms: 1_000_000n,
      us: 1000n,
      ns: 1n,
    }
    const ns = (text: string): bigint =>
      [...typed(text, "LTIME").text.matchAll(/(\d+)(ms|us|ns|d|h|m|s)/g)].reduce((sum, [, n, unit]) => sum + BigInt(n!) * UNIT[unit!]!, 0n)
    expect(LTIME_TEXT_CASES.map((c) => `${c.name}: ${ns(recordedInput(c))}`)).toEqual(LTIME_TEXT_CASES.map((c) => `${c.name}: ${c.input}`))
  })

  test("every long-calendar text case's input is the value its fixture ran", () => {
    const got = LONG_CALENDAR_TEXT_CASES.map((c) => `${c.name}: ${recordedInput(c)}`)
    expect(got).toEqual(LONG_CALENDAR_TEXT_CASES.map((c) => `${c.name}: ${monitored(c.input)}`))
  })
})
