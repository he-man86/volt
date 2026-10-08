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
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { elementaryType, elementaryTypeRef } from "../../src/frontend/types/index.js"
import { rustType } from "../../src/transpile/index.js"
// the runtime registry — a deep path, test support only (it is not surface)
import { runtimeText } from "../../src/transpile/emit/rust/runtime/index.js"
import type { Case } from "../../src/transpile/semantics/cases.js"
import { REAL_TO_INT_CASES, type RealToIntInput } from "../../src/transpile/semantics/numeric.cases.js"
import {
  LONG_CALENDAR_TEXT_CASES,
  LREAL_TEXT_CASES,
  LREAL_TIE_CASES,
  type LongCalendarInput,
} from "../../src/transpile/semantics/text.cases.js"
import { RUNS } from "./support/recordings.js"
import { buildRust } from "./support/rustc-cache.js"
import { RUSTC, skipRustSuite } from "./support/rustc.js"


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

/** An f64 as the exact Rust expression for it — the bits, so no literal's rounding stands between the case and the run. */
function f64(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return `f64::from_bits(0x${view.getBigUint64(0).toString(16)})`
}

/** An f32 (a REAL case's value, already single precision) widened as the emitter widens it: `as f64`. */
function f32(value: number): string {
  if (!Object.is(Math.fround(value), value)) throw new Error(`${value} is not a REAL`)
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, value)
  return `f32::from_bits(0x${view.getUint32(0).toString(16)}) as f64`
}

/** The emitter's REAL → integer: the destination's register half (`iec_r2i64` at 64 bits, else `iec_r2i32`), then the
 *  destination's own Rust type (`emit/rust/convert.ts` `exprConvert`). */
function realToInt(input: RealToIntInput): string {
  const elem = elementaryType(input.to)
  if (elem === undefined) throw new Error(`no elementary type ${input.to}`)
  const to = elementaryTypeRef(elem)
  const value = input.from === "REAL" ? f32(input.value) : f64(input.value)
  const wide = elem.bits >= 64
  return `iec_r2i${wide ? 64 : 32}(${value}) as ${rustType(to)}`
}

/** Build `runtime` + a `main` printing each expression on its own line, run it, and return the lines. */
async function runTwin(name: string, runtime: string, exprs: readonly string[]): Promise<string[]> {
  const main = `fn main() {\n${exprs.map((e) => `    println!("{}", ${e});`).join("\n")}\n}\n`
  const dir = await mkdtemp(join(tmpdir(), `volt-twin-${name}-`))
  try {
    const file = join(dir, `${name}.rs`)
    const exe = join(dir, process.platform === "win32" ? `${name}.exe` : name)
    const build = await buildRust([RUSTC!, "--edition", "2021", "-o", exe, file], file, exe, `#![allow(dead_code)]\n${runtime}\n${main}`)
    expect(build.stderr).toBe("")
    const ran = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe", timeout: 30_000 })
    expect(ran.exitCode).toBe(0)
    return ran.stdout.toString().trim().split(/\r?\n/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Every case's printed line beside its expected text, as `name: got` lines — equal when the twin agrees. */
function compare<I, O>(cases: readonly Case<I, O>[], got: readonly string[]): { got: string[]; expected: string[] } {
  expect(got).toHaveLength(cases.length)
  return {
    got: cases.map((c, i) => `${c.name}: ${got[i]}`),
    expected: cases.map((c) => `${c.name}: ${String(c.expected)}`),
  }
}

describe("runtime twins — the case tables hold their recordings", () => {
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

  test("every text case names a recording — but the -0 cell, which no fixture ran", () => {
    const lreal = Object.values(LREAL_TEXT_CASES).flat()
    expect(lreal).toHaveLength(25)
    const unrecorded = [...lreal, ...LREAL_TIE_CASES, ...LONG_CALENDAR_TEXT_CASES].filter((c) => c.recording === undefined)
    expect(unrecorded.map((c) => c.name)).toEqual(["-0"])
  })

  test("every text case that names a recording prints what CODESYS recorded", () => {
    const named = [...Object.values(LREAL_TEXT_CASES).flat(), ...LREAL_TIE_CASES, ...LONG_CALENDAR_TEXT_CASES].filter(
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

  test("every long-calendar text case's input is the value its fixture ran", () => {
    const got = LONG_CALENDAR_TEXT_CASES.map((c) => `${c.name}: ${recordedInput(c)}`)
    expect(got).toEqual(LONG_CALENDAR_TEXT_CASES.map((c) => `${c.name}: ${monitored(c.input)}`))
  })
})

describe.skipIf(skipRustSuite())("runtime twins — the Rust runtime against the case tables", () => {
  test("runtime/text.ts: iec_lreal_text over every LREAL case, the 16th-digit ties among them", async () => {
    const cases = [...Object.values(LREAL_TEXT_CASES).flat(), ...LREAL_TIE_CASES]
    const got = await runTwin("text_lreal", runtimeText("text"), cases.map((c) => `iec_lreal_text(${f64(c.input)})`))
    const { got: g, expected } = compare(cases, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/text.ts: iec_ldt_text / iec_ldate_text / iec_ltod_text over every long-calendar case", async () => {
    const cases = LONG_CALENDAR_TEXT_CASES
    const fn = { LDT: "iec_ldt_text", LDATE: "iec_ldate_text", LTOD: "iec_ltod_text" } as const
    // the emitter hands the u64 over `as i64`: CODESYS reads it signed (`tr_12_fmt_long_dates`)
    const got = await runTwin("text_long", runtimeText("text"), cases.map((c) => `${fn[c.input.name]}(${c.input.ns}u64 as i64)`))
    const { got: g, expected } = compare(cases, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/numeric.ts: iec_r2i32 / iec_r2i64 over every recorded REAL -> integer cell", async () => {
    const got = await runTwin(
      "numeric_r2i",
      runtimeText("iec_r2i32") + runtimeText("iec_r2i64"),
      REAL_TO_INT_CASES.map((c) => realToInt(c.input)),
    )
    const { got: g, expected } = compare(REAL_TO_INT_CASES, got)
    expect(g).toEqual(expected)
  }, 60_000)
})
