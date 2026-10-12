/**
 * THE TWIN HARNESS, RUST SIDE (design.md P3, §8; transpile-restructure 1.5.15) — each mirrored model's case table run
 * against `emit/rust/runtime/`: one program per table, built with `rustc`, each printed line required to equal the case's
 * `expected`; and the runtime registry held clippy-pedantic clean. The tables' own recordings are `runtime-twins.test.ts`'s.
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
} from "../../src/transpile/semantics/text.cases.js"
import { PARSE_INT_CASES, type ParseIntInput, WIDE_PARSE_INT_CASES } from "../../src/transpile/semantics/parse.cases.js"
import { type StringCase, type StringInput } from "../../src/transpile/semantics/string.cases.js"
import { lengthOf } from "../../src/transpile/semantics/string.js"
import {
  CASE_IMAGE,
  type MemoryInput,
  type MemoryType,
  type OverlayScalar,
  type OverlayType,
  type OverlayValue,
  REINTERPRET_CASES,
  type ReinterpretInput,
} from "../../src/transpile/semantics/memory.cases.js"
import { reinterpretText } from "../../src/transpile/emit/rust/reinterpret.js"
import { type NaNInput } from "../../src/transpile/semantics/nan.cases.js"
import { Prec, printed, type Printed } from "../../src/transpile/emit/rust/precedence.js"
import { FAULT_TEXT } from "../../src/transpile/ir/faults.js"
import { buildRust } from "./support/rustc-cache-build.js"
import { CLIPPY, RUSTC, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { LINT_FLAGS, pedanticGroups } from "./support/transpile/lint-policy.js"
import { STRING_CASE_LIST, MEMORY_CASE_LIST, NAN_CASE_LIST } from "./support/runtime-twins.js"

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
function parseIntRust(input: ParseIntInput, wide = false): string {
  const elem = elementaryType(input.to)
  if (elem === undefined) throw new Error(`no elementary type ${input.to}`)
  const codes = [...input.text].map((ch) => ch.charCodeAt(0))
  const target = rustType(elementaryTypeRef(elem))
  const unsigned = !elem.signed
  if (!wide) return `iec_parse_int(&[${codes.join(", ")}], ${unsigned}) as ${target}`
  // a WSTRING's units are u16, which the first unit's suffix says (and an empty array's length, which has none)
  return `iec_parse_int_wide(&${codes.length === 0 ? "[0u16; 0]" : `[${codes.map((u, i) => (i === 0 ? `${u}u16` : `${u}`)).join(", ")}]`}, ${unsigned}) as ${target}`
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

/** A NaN case's operand as the Rust it is: its bits, at the width the operation reads it (`widen` a REAL, `narrow` an
 *  LREAL, anything else its own type). */
function nanArg(bits: bigint, input: NaNInput): string {
  const real = input.op === "widen" || (input.op !== "narrow" && input.type === "REAL")
  return `${real ? "f32" : "f64"}::from_bits(0x${bits.toString(16)})`
}

/** A NaN case as the emitter prints its operation (`emit/rust/expr.ts`, `builtins.ts`, `convert.ts`), its bits in hex. */
function nanCaseRust(input: NaNInput): string {
  const [a, b, c] = input.args.map((x) => nanArg(x, input))
  const real = input.type === "REAL"
  // a math function goes through f64 and back for a REAL (`emit/rust/builtins.ts` `math`), each NaN chosen by `iec_fn`;
  // LN and LOG through `iec_log`
  const viaF64 = (f: string, x: string): string => (real ? `iec_narrow(iec_fn(iec_widen(${x}), f64::${f}))` : `iec_fn(${x}, f64::${f})`)
  const value = ((): string => {
    switch (input.op) {
      case "add":
        return `iec_fadd(${a}, ${b})`
      case "sub":
        return `iec_fsub(${a}, ${b})`
      case "mul":
        return `iec_fmul(${a}, ${b})`
      case "div":
        return `iec_fdivz(${a}, ${b})`
      case "neg":
        return `iec_fneg${real ? 32 : 64}(${a})`
      case "abs":
        return `iec_fabs${real ? 32 : 64}(${a})`
      case "copy":
        return a!
      case "widen":
        return `iec_widen(${a})`
      case "narrow":
        return `iec_narrow(${a})`
      case "sqrt":
        return `iec_fn(${a}, ${real ? "f32" : "f64"}::sqrt)`
      case "ln":
      case "log": {
        const f = input.op === "ln" ? "ln" : "log10"
        return real ? `iec_narrow(iec_fn(iec_log(iec_widen(${a})), f64::${f}))` : `iec_fn(iec_log(${a}), f64::${f})`
      }
      case "expt":
        return real ? `iec_narrow(iec_pow(iec_widen(${a}), iec_widen(${b!})))` : `iec_pow(${a}, ${b})`
      case "max":
      case "min":
        return `iec_f${input.op}(${a}, ${b})`
      case "limit":
        return `iec_fmin(iec_fmax(${a}, ${b}), ${c})`
      case "sel":
      case "mux":
        return `(if true { ${b} } else { ${a} })`
      default:
        return viaF64(input.op, a!)
    }
  })()
  return `format!("{:x}", ${value}.to_bits())`
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

/** Build `runtime` + a `main` printing each expression on its own line, run it, and return the lines — `optimized`, built
 *  as `-O` builds it (a transpiled program a user builds with `--release`), which the harness's own builds are not. */
async function runTwin(name: string, runtime: string, exprs: readonly string[], optimized = false): Promise<string[]> {
  const main = `fn main() {\n${exprs.map((e) => `    println!("{}", ${e});`).join("\n")}\n}\n`
  const dir = await mkdtemp(join(tmpdir(), `volt-twin-${name}-`))
  try {
    const file = join(dir, `${name}.rs`)
    const exe = join(dir, process.platform === "win32" ? `${name}.exe` : name)
    const build = await buildRust([RUSTC!, "--edition", "2021", ...(optimized ? ["-O"] : []), "-o", exe, file], file, exe, `#![allow(dead_code)]\n${runtime}\n${main}`)
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

/** A string case as one Rust block: the variable started at zeros, each operation, then what `read` reads of it — every
 *  unit of its buffer, unless another read is asked. */
function stringCaseRust(input: StringInput, read = "format!(\"{:?}\", s.units.iter().map(|&u| u as u32).collect::<Vec<u32>>())"): string {
  const type = input.wide ? "IecWString" : "IecString"
  const unit = input.wide ? "u16" : "u8"
  const units = (text: string): string =>
    input.wide ? `&[${[...text].map((ch) => `${ch.charCodeAt(0)}u16`).join(", ")}]` : `b"${[...text].map((ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")}"`
  const ops = input.ops.map((op) =>
    "store" in op
      ? `s.${op.within === undefined ? "store" : `store_within::<${op.within}, _>`}(&${type}::<${op.n}>::lit(${units(op.store)}));`
      : `s.set_char(${op.at}, ${op.unit}${unit});`,
  )
  return `{ let mut s = ${type}::<${input.m}>::new(); ${ops.join(" ")} ${read} }`
}

/** The buffer a case expects, as `stringCaseRust` prints it: its m units, zeros past what it holds. */
const stringCaseUnits = (c: StringCase): string =>
  `[${Array.from({ length: c.input.m }, (_, i) => (i < c.expected.length ? c.expected.charCodeAt(i) : 0)).join(", ")}]`

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

  test("runtime/string.ts: IecStr::store / store_within / set_char (lean 7.4.3: `s[i] := c` in place) over every string case", async () => {
    const got = await runTwin("string_store", runtimeText("string_store_within"), STRING_CASE_LIST.map((c) => stringCaseRust(c.input)))
    expect(got).toHaveLength(STRING_CASE_LIST.length)
    expect(STRING_CASE_LIST.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(STRING_CASE_LIST.map((c) => `${c.name}: ${stringCaseUnits(c)}`))
  }, 60_000)

  test("runtime/string.ts: IecStr::length (LEN_INTERNAL, 7.4.6) over every string case — the interpreter's lengthOf", async () => {
    const got = await runTwin("string_length", runtimeText("string_length", "string_store_within"), STRING_CASE_LIST.map((c) => stringCaseRust(c.input, "s.length()")))
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

  test("runtime/numeric.ts + the emitter's REAL operations: a NaN's bits through every recorded operation (8.2)", async () => {
    const runtime = runtimeText("iec_fadd", "iec_fsub", "iec_fmul", "iec_fdivz", "iec_fn", "iec_widen", "iec_narrow", "iec_fneg32", "iec_fneg64", "iec_fabs32", "iec_fabs64", "iec_log", "iec_pow", "iec_fmax", "iec_fmin")
    const got = await runTwin("nan_bits", runtime, NAN_CASE_LIST.map((c) => nanCaseRust(c.input)))
    expect(NAN_CASE_LIST.map((c, i) => `${c.name}: ${got[i]}`)).toEqual(NAN_CASE_LIST.map((c) => `${c.name}: ${c.expected.toString(16)}`))
    // …and in an OPTIMIZED build (gate 8c): which NaN an operation answers is the code's choice, not the compiler's — LLVM
    // commutes an add and folds a widened NaN under -O, where the unoptimized build only happened to answer CODESYS's
    const optimized = await runTwin("nan_bits_opt", runtime, NAN_CASE_LIST.map((c) => nanCaseRust(c.input)), true)
    expect(NAN_CASE_LIST.map((c, i) => `${c.name}: ${optimized[i]}`)).toEqual(NAN_CASE_LIST.map((c) => `${c.name}: ${c.expected.toString(16)}`))
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

  test("runtime/parse.ts: iec_parse_int_wide over every recorded WSTRING -> integer cell (8.2), stored at its target", async () => {
    const got = await runTwin("parse_int_wide", runtimeText("iec_parse_int_wide"), WIDE_PARSE_INT_CASES.map((c) => parseIntRust(c.input, true)))
    const { got: g, expected } = compare(WIDE_PARSE_INT_CASES, got)
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
