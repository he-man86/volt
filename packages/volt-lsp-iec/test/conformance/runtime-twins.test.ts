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
import { elementaryRef, elementaryType, elementaryTypeRef, type Type } from "../../src/frontend/types/index.js"
import { rustType } from "../../src/transpile/index.js"
// the runtime registry — a deep path, test support only (it is not surface)
import { RUNTIME_IDS, runtimeText } from "../../src/transpile/emit/rust/runtime/index.js"
import type { Case } from "../../src/transpile/semantics/cases.js"
import {
  EXPT_CASES,
  type ExptInput,
  INT_TO_REAL_CASES,
  REAL_TO_INT_CASES,
  type RealToIntInput,
  SELECT_CASES,
  type SelectInput,
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
import { PARSE_INT_CASES, type ParseIntInput } from "../../src/transpile/semantics/parse.cases.js"
import { type Seen, STRING_CASES, type StringCase, type StringInput } from "../../src/transpile/semantics/string.cases.js"
import { lengthOf, visible } from "../../src/transpile/semantics/string.js"
import {
  CASE_IMAGE,
  MEMORY_CASES,
  type MemoryInput,
  type MemoryType,
  type OverlayScalar,
  type OverlayType,
  type OverlayValue,
  REINTERPRET_CASES,
  type ReinterpretInput,
} from "../../src/transpile/semantics/memory.cases.js"
import { reinterpretText } from "../../src/transpile/emit/rust/reinterpret.js"
import { Prec, printed, type Printed } from "../../src/transpile/emit/rust/precedence.js"
import { FAULT_TEXT } from "../../src/transpile/ir/faults.js"
import { RUNS } from "./support/recordings.js"
import { buildRust } from "./support/rustc-cache.js"
import { CLIPPY, RUSTC, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { LINT_FLAGS, pedanticGroups } from "./support/transpile/lint-policy.js"


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

/** A STRING → integer case as the Rust that parses its text and stores it at its target (`emit/rust/convert.ts`'s `as`). */
function parseIntRust(input: ParseIntInput): string {
  const elem = elementaryType(input.to)
  if (elem === undefined) throw new Error(`no elementary type ${input.to}`)
  const bytes = [...input.text].map((ch) => ch.charCodeAt(0)).join(", ")
  return `iec_parse_int(&[${bytes}]) as ${rustType(elementaryTypeRef(elem))}`
}

/** The recorded NaN (CODESYS's SQRT(-1), sign bit set) and -0 a compare-select case runs on, as the Rust it is. */
function selectArg(value: number, type: SelectInput["type"]): string {
  const real = type === "REAL"
  if (Number.isNaN(value)) return real ? "f32::from_bits(0xffc00000)" : "f64::from_bits(0xfff8000000000000)"
  if (Object.is(value, -0)) return real ? "-0.0f32" : "-0.0f64"
  return `${value}.0${real ? "f32" : "f64"}`
}

/** A compare-select case as the emitter prints it (`iec_fmax`, `iec_fmin`; LIMIT as MIN(MAX(mn, in), mx)), its bits. */
function selectCaseRust(input: SelectInput): string {
  const [a, b, c] = input.args.map((v) => selectArg(v, input.type))
  const value = input.fn === "limit" ? `iec_fmin(iec_fmax(${a}, ${b}), ${c})` : `iec_f${input.fn}(${a}, ${b})`
  return `${value}.to_bits()`
}

/** An EXPT case as the emitter prints it — `iec_pow` over f64, narrowed for a REAL — as its bits in hex, or `stop` when
 *  it panics (the task stopping). */
function exptCaseRust(input: ExptInput): string {
  const arg = (v: number): string => (input.type === "REAL" ? f32(v) : f64(v))
  const call = `iec_pow(${arg(input.x)}, ${arg(input.y)})`
  const bits = input.type === "REAL" ? `(${call} as f32).to_bits()` : `${call}.to_bits()`
  return `std::panic::catch_unwind(|| format!("{:x}", ${bits})).unwrap_or_else(|_| "stop".to_string())`
}

/** An EXPT case's expected answer as `exptCaseRust` prints it. */
function exptExpected(c: (typeof EXPT_CASES)[number]): string {
  if (c.expected === "stop") return "stop"
  const view = new DataView(new ArrayBuffer(8))
  if (c.input.type === "REAL") {
    view.setFloat32(0, c.expected)
    return view.getUint32(0).toString(16)
  }
  view.setFloat64(0, c.expected)
  return view.getBigUint64(0).toString(16)
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

/** A formatter's STRING as the text it holds — `iec_*_text` writes into an `IecString<N>` (lean 9.4). */
const written = (call: string): string => `String::from_utf8_lossy(${call}.units())`

/** Every case's printed line beside its expected text, as `name: got` lines — equal when the twin agrees. */
function compare<I, O>(cases: readonly Case<I, O>[], got: readonly string[]): { got: string[]; expected: string[] } {
  expect(got).toHaveLength(cases.length)
  return {
    got: cases.map((c, i) => `${c.name}: ${got[i]}`),
    expected: cases.map((c) => `${c.name}: ${String(c.expected)}`),
  }
}

/** Every string case, its rule's cases flattened. */
const STRING_CASE_LIST: readonly StringCase[] = Object.values(STRING_CASES).flat()

/** A recorded value a string case names, refused by name when the recording does not hold it. */
function recordedAt(fixture: string, path: string): string {
  const value = RUNS[fixture]?.values?.[path]
  if (value === undefined) throw new Error(`${fixture} recorded no ${path}`)
  return value
}

/** What a buffer shows where a recording looked at it: the unit (0 past what is held), the string, or its length. */
function shown(buffer: string, seen: Seen): string {
  if ("unit" in seen) return String(seen.unit < buffer.length ? buffer.charCodeAt(seen.unit) : 0)
  return "text" in seen ? visible(buffer) : String(lengthOf(buffer))
}

/** A recording's value in `shown`'s terms: a BYTE/WORD/INT as its number, a STRING ('…') or WSTRING ("…") as its text. */
function asShown(value: string, where: string): string {
  if (/^["']/.test(value)) {
    if (value.at(-1) !== value[0]) throw new Error(`${where}: not a recorded string (${value})`)
    return value.slice(1, -1)
  }
  return typed(value, where).text
}

/** A string case as one Rust block: the variable started at zeros, each operation, then what `read` reads of it — every
 *  unit of its buffer, unless another read is asked. */
function stringCaseRust(input: StringInput, read = "format!(\"{:?}\", s.units.iter().map(|&u| u as u32).collect::<Vec<u32>>())"): string {
  const type = input.wide ? "IecWString" : "IecString"
  const unit = input.wide ? "u16" : "u8"
  const units = (text: string): string =>
    input.wide ? `&[${[...text].map((ch) => `${ch.charCodeAt(0)}u16`).join(", ")}]` : `b"${[...text].map((ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")}"`
  const ops = input.ops.map((op) =>
    "store" in op ? `s.store(&${type}::<${op.n}>::lit(${units(op.store)}));` : `s.set_char(${op.at}, ${op.unit}${unit});`,
  )
  return `{ let mut s = ${type}::<${input.m}>::new(); ${ops.join(" ")} ${read} }`
}

/** The buffer a case expects, as `stringCaseRust` prints it: its m units, zeros past what it holds. */
const stringCaseUnits = (c: StringCase): string =>
  `[${Array.from({ length: c.input.m }, (_, i) => (i < c.expected.length ? c.expected.charCodeAt(i) : 0)).join(", ")}]`

/** Every byte-image case, its rule's cases flattened. */
const MEMORY_CASE_LIST = Object.values(MEMORY_CASES).flat()

/** An IEC type of the memory cases as its Rust type. */
const RUST_OF: Readonly<Record<MemoryType, string>> = { BOOL: "bool", BYTE: "u8", SINT: "i8", WORD: "u16", INT: "i16", DWORD: "u32", DINT: "i32", REAL: "f32", LINT: "i64", LREAL: "f64" }

/** A byte-image case as one Rust expression: the image, its stores, its read printed as the case prints it — or the fault
 *  it stopped on, caught (`fault_of` maps the panic text back to its kind). */
function memoryCaseRust(input: MemoryInput): string {
  const at = (offset: number): string => `IMAGE_BASE + ${offset}`
  const stores = input.stores.map((st) =>
    st.type === "BOOL" ? `m.st(${at(st.at)}, [u8::from(${String(st.value)})]);` : `m.st(${at(st.at)}, (${String(st.value)}${RUST_OF[st.type]}).to_le_bytes());`,
  )
  const r = input.read
  const read =
    "order" in r
      ? `m.order(${at(r.order[0])}, ${at(r.order[1])}).to_string()`
      : r.load === "BOOL"
        ? `(m.ld::<1>(${at(r.at)})[0] != 0).to_string()`
        : r.load === "REAL" || r.load === "LREAL"
          ? `format!("{:x}", ${RUST_OF[r.load]}::from_le_bytes(m.ld(${at(r.at)})).to_bits())`
          : `${RUST_OF[r.load]}::from_le_bytes(m.ld(${at(r.at)})).to_string()`
  const regions = CASE_IMAGE.regions.map(([s0, e0]) => `(${s0}, ${e0})`).join(", ")
  return `std::panic::catch_unwind(|| { let ${stores.length === 0 ? "" : "mut "}m = Mem::image(${CASE_IMAGE.size}, &[], &[${regions}]); ${stores.join(" ")} ${read} }).unwrap_or_else(fault_of)`
}

const REINTERPRET_CASE_LIST = Object.values(REINTERPRET_CASES).flat()

/** A reinterpret case's scalar as its Rust type. */
const OVERLAY_RUST: Readonly<Record<OverlayScalar, string>> = { BYTE: "u8", SINT: "i8", WORD: "u16", INT: "i16", DWORD: "u32", DINT: "i32", REAL: "f32", LWORD: "u64", LINT: "i64", LREAL: "f64" }

/** A reinterpret case's type, as the IR holds it. */
function overlayType(t: OverlayType): Type {
  if (typeof t === "string") return elementaryRef(t)
  return { kind: "array", element: elementaryRef(t.array), bounds: [{ lower: BigInt(t.lower), upper: BigInt(t.lower + t.length - 1) }], dims: [{} as never] } as Type
}

/** A reinterpret case as one Rust expression: the overlay as the emitter prints it (`reinterpretText`), its answer
 *  printed as the case prints it — an integer as itself, a REAL or LREAL by its bits in hex, an array as `[e, …]`. */
function reinterpretCaseRust(input: ReinterpretInput): string {
  const scalarOf = (t: OverlayType): OverlayScalar => (typeof t === "string" ? t : t.array)
  const lit = (v: bigint | number, t: OverlayScalar): string => `(${Object.is(v, -0) ? "-0" : String(v)}${OVERLAY_RUST[t]})`
  const value = (v: OverlayValue, t: OverlayType): Printed =>
    printed(Array.isArray(v) ? `[${(v as (bigint | number)[]).map((e) => lit(e, scalarOf(t))).join(", ")}]` : lit(v as bigint | number, scalarOf(t)), Prec.Postfix)
  const rust = (t: OverlayType): string => (typeof t === "string" ? OVERLAY_RUST[t] : `[${OVERLAY_RUST[t.array]}; ${t.length}]`)
  const one = (e: string, t: OverlayScalar): string => (t === "REAL" || t === "LREAL" ? `format!("{:x}", ${e}.to_bits())` : `${e}.to_string()`)
  const shown = typeof input.to === "string" ? one("r", input.to) : `format!("[{}]", r.iter().map(|e| ${one("e", input.to.array)}).collect::<Vec<_>>().join(", "))`
  const text = reinterpretText(value(input.value, input.from), overlayType(input.from), overlayType(input.to), input.over === undefined ? undefined : value(input.over, input.to), () => {})
  return `{ let r: ${rust(input.to)} = ${text}; ${shown} }`
}

const NEWLINE = String.fromCharCode(10)

/** The Rust that maps a caught panic back to `fault: <kind>`, every image fault's text written once in `ir/faults.ts`. */
const FAULT_OF = `fn fault_of(e: Box<dyn std::any::Any + Send>) -> String {
    let text = e.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| e.downcast_ref::<String>().cloned()).unwrap_or_default();
${(["null-dereference", "address-outside-image", "address-across-frames"] as const).map((k) => `    if text == ${JSON.stringify(FAULT_TEXT[k])} { return "fault: ${k}".to_string(); }`).join(NEWLINE)}
    format!("panic: {text}")
}
`

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

  test("every STRING -> integer case is the recorded cell of the fixture it names, from the text it parsed", () => {
    const bad: string[] = []
    for (const c of PARSE_INT_CASES) {
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

describe.skipIf(skipRustSuite())("runtime twins — the Rust runtime against the case tables", () => {
  test("runtime/text.ts: iec_lreal_text over every LREAL case, the 16th-digit ties among them", async () => {
    const cases = [...Object.values(LREAL_TEXT_CASES).flat(), ...LREAL_TIE_CASES]
    const got = await runTwin("text_lreal", runtimeText("iec_lreal_text"), cases.map((c) => written(`iec_lreal_text::<255>(${f64(c.input)})`)))
    const { got: g, expected } = compare(cases, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/text.ts: iec_ldt_text / iec_ldate_text / iec_ltod_text over every long-calendar case", async () => {
    const cases = LONG_CALENDAR_TEXT_CASES
    const fn = { LDT: "iec_ldt_text", LDATE: "iec_ldate_text", LTOD: "iec_ltod_text" } as const
    // the emitter hands the u64 over `as i64`: CODESYS reads it signed (`tr_12_fmt_long_dates`)
    const got = await runTwin("text_long", runtimeText("iec_ldt_text", "iec_ldate_text", "iec_ltod_text"), cases.map((c) => written(`${fn[c.input.name]}::<255>(${c.input.ns}u64 as i64)`)))
    const { got: g, expected } = compare(cases, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/text.ts: iec_ltime_text over every LTIME case, the u64 handed over uncast", async () => {
    const got = await runTwin("text_ltime", runtimeText("iec_ltime_text"), LTIME_TEXT_CASES.map((c) => written(`iec_ltime_text::<255>(${c.input}u64)`)))
    const { got: g, expected } = compare(LTIME_TEXT_CASES, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/string.ts: IecStr::store / set_char (lean 7.4.3: `s[i] := c` in place) over every string case", async () => {
    const got = await runTwin("string_store", runtimeText("string"), STRING_CASE_LIST.map((c) => stringCaseRust(c.input)))
    expect(got).toHaveLength(STRING_CASE_LIST.length)
    expect(STRING_CASE_LIST.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(STRING_CASE_LIST.map((c) => `${c.name}: ${stringCaseUnits(c)}`))
  }, 60_000)

  test("runtime/string.ts: IecStr::length (LEN_INTERNAL, 7.4.6) over every string case — the interpreter's lengthOf", async () => {
    const got = await runTwin("string_length", runtimeText("string_length"), STRING_CASE_LIST.map((c) => stringCaseRust(c.input, "s.length()")))
    expect(got).toHaveLength(STRING_CASE_LIST.length)
    expect(STRING_CASE_LIST.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(STRING_CASE_LIST.map((c) => `${c.name}: ${lengthOf(c.expected)}`))
  }, 60_000)

  test("runtime/pointer.ts: Mem over every byte-image case — the signalling NaN a REAL keeps included", async () => {
    const program = `${runtimeText("mem", "mem_ld", "mem_ld_bool", "mem_st", "mem_order", "iec_ix")}
${FAULT_OF}`
    const got = await runTwin("memory", program, ["{ std::panic::set_hook(Box::new(|_| {})); 0 }", ...MEMORY_CASE_LIST.map((c) => memoryCaseRust(c.input))])
    expect(MEMORY_CASE_LIST.map((c, i) => `${c.name}: ${got[i + 1]}`)).toEqual(MEMORY_CASE_LIST.map((c) => `${c.name}: ${c.expected}`))
  }, 60_000)

  test("emit/rust/reinterpret.ts + runtime/bytes.ts: a UNION member's overlay over every reinterpret case (lean 7.8.4)", async () => {
    const got = await runTwin("reinterpret", runtimeText("iec_bytes", "iec_elements", "iec_overlay"), REINTERPRET_CASE_LIST.map((c) => reinterpretCaseRust(c.input)))
    expect(REINTERPRET_CASE_LIST.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(REINTERPRET_CASE_LIST.map((c) => `${c.name}: ${c.expected}`))
  }, 60_000)

  test("runtime/numeric.ts: iec_fmax / iec_fmin over every recorded compare-select cell, the NaN's sign bit kept", async () => {
    const got = await runTwin("numeric_select", runtimeText("iec_fmax") + runtimeText("iec_fmin"), SELECT_CASES.map((c) => selectCaseRust(c.input)))
    const { got: g, expected } = compare(SELECT_CASES, got)
    expect(g).toEqual(expected)
  }, 60_000)

  // 7.3.6: a REAL SQRT is printed `f32::sqrt` — the recorded cells, and the f64 round trip it replaced over the REAL edges
  // and a stride through every bit pattern (the exhaustive 2^32 run, measured once, found 0 differences)
  test("emit/rust/builtins.ts: f32::sqrt over every recorded REAL SQRT cell, and the f64 round trip over a stride of all REALs", async () => {
    const bits = (v: number): string => {
      const view = new DataView(new ArrayBuffer(4))
      view.setFloat32(0, v)
      return `0x${view.getUint32(0).toString(16)}`
    }
    const shown = (v: number): string => (Number.isNaN(v) ? "nan" : bits(v))
    const sweep = [
      "{ let same = |a: f32, b: f32| (a.is_nan() && b.is_nan()) || a.to_bits() == b.to_bits();",
      "let mut diff = 0u32; let mut i: u64 = 0;",
      "while i <= u64::from(u32::MAX) { let x = f32::from_bits(i as u32); if !same(x.sqrt(), (f64::from(x).sqrt()) as f32) { diff += 1; } i += 4099; }",
      "for x in [0.0f32, -0.0, f32::INFINITY, f32::NEG_INFINITY, f32::NAN, f32::MIN_POSITIVE, f32::MAX, f32::from_bits(1), 2.0, -1.0] { if !same(x.sqrt(), (f64::from(x).sqrt()) as f32) { diff += 1; } }",
      "diff }",
    ].join(" ")
    const got = await runTwin("numeric_sqrt", "", [
      ...SQRT_CASES.map((c) => `{ let r = f32::from_bits(${bits(c.input.value)}).sqrt(); if r.is_nan() { "nan".to_string() } else { format!("0x{:x}", r.to_bits()) } }`),
      sweep,
    ])
    expect(SQRT_CASES.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(SQRT_CASES.map((c) => `${c.name}: ${shown(c.expected)}`))
    expect(got.at(-1)).toBe("0")
  }, 60_000)

  test("runtime/numeric.ts: iec_pow over every recorded EXPT cell — C's pow, and the stop on 0 to a finite negative", async () => {
    const got = await runTwin("numeric_expt", runtimeText("iec_pow"), [
      "{ std::panic::set_hook(Box::new(|_| {})); 0 }",
      ...EXPT_CASES.map((c) => exptCaseRust(c.input)),
    ])
    expect(EXPT_CASES.map((c, i) => `${c.name}: ${got[i + 1]}`)).toEqual(EXPT_CASES.map((c) => `${c.name}: ${exptExpected(c)}`))
  }, 60_000)

  test("emit/rust/convert.ts: a 64-bit integer `as f32` over every recorded integer -> REAL cell — one rounding", async () => {
    const rust = { LINT: "i64", ULINT: "u64", LWORD: "u64" } as const
    const got = await runTwin("numeric_i2r", "", INT_TO_REAL_CASES.map((c) => `format!("{:x}", (${c.input.value}${rust[c.input.from]} as f32).to_bits())`))
    const bits = (v: number): string => {
      const view = new DataView(new ArrayBuffer(4))
      view.setFloat32(0, v)
      return view.getUint32(0).toString(16)
    }
    expect(INT_TO_REAL_CASES.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(INT_TO_REAL_CASES.map((c) => `${c.name}: ${bits(c.expected)}`))
  }, 60_000)

  test("runtime/parse.ts: iec_parse_int over every recorded STRING -> integer cell, stored at its target", async () => {
    const got = await runTwin("parse_int", runtimeText("iec_parse_int"), PARSE_INT_CASES.map((c) => parseIntRust(c.input)))
    const { got: g, expected } = compare(PARSE_INT_CASES, got)
    expect(g).toEqual(expected)
  }, 60_000)

  test("runtime/numeric.ts: iec_trunc_i32 over every recorded TRUNC cell", async () => {
    const got = await runTwin("numeric_trunc", runtimeText("iec_trunc_i32"), TRUNC_CASES.map((c) => `iec_trunc_i32(${c.input.from === "REAL" ? f32(c.input.value) : f64(c.input.value)})`))
    const { got: g, expected } = compare(TRUNC_CASES, got)
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

/**
 * THE RUNTIME IS IDIOMATIC RUST (transpile-restructure 7.9.5): every registry helper, compiled together under the map's
 * lint flags, carries no `clippy::pedantic` or `clippy::perf` finding — each one was counted once per fixture that
 * printed it (11,255 of the map's pedantic total at 7.1). A lint on a helper is listed with its line, so the fix is named.
 */
describe.skipIf(skipLintCheck())("runtime twins — the registry is clippy-pedantic clean", () => {
  test("no pedantic or perf finding on any registry helper", async () => {
    const dir = await mkdtemp(join(tmpdir(), "volt-runtime-lint-"))
    try {
      const file = join(dir, "runtime.rs")
      const source = `${runtimeText(...RUNTIME_IDS)}\nfn main() {}\n`
      await Bun.write(file, source)
      const built = Bun.spawnSync([CLIPPY!, "--edition", "2021", ...LINT_FLAGS, "--emit", "metadata", "-o", join(dir, "runtime.rmeta"), file], { stdout: "pipe", stderr: "pipe" })
      expect(built.exitCode).toBe(0)
      const groups = pedanticGroups()
      const lines = source.split("\n")
      const found = built.stderr
        .toString()
        .split(/\r?\n/)
        .filter((raw) => raw.startsWith("{"))
        .map((raw) => JSON.parse(raw) as { level?: string; code?: { code?: string }; spans?: { line_start: number; is_primary: boolean }[] })
        .filter((d) => d.level === "warning" && d.code?.code !== undefined && groups.has(d.code.code))
        .map((d) => {
          const line = (d.spans?.find((sp) => sp.is_primary) ?? d.spans?.[0])?.line_start ?? 0
          return `${d.code!.code} at ${line}: ${lines[line - 1]?.trim().slice(0, 100)}`
        })
      expect(found).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
