/** CONVERSIONS AS RUST — the `convert` node by the measured rules (design §11), and the casts a builtin adds. */
import type { IrExpr, IrPou, IrValue } from "../../ir/index.js"
import { isTemporal, type Type } from "../../../frontend/types/index.js"
import { print } from "./expr.js"
import { at, Prec, printed, type Printed } from "./precedence.js"
import { type Printer, use } from "./printer.js"
import type { RuntimeId } from "./runtime/index.js"
import { emittedFamily, isReal32, rustType, stringPath, stringType } from "./types.js"
import { grouped } from "./values.js"

/**
 * `value as target` (or `target::from(value)`), or `value` unchanged when it already IS that Rust type — the twin of the
 * identity rule in `convert`, for the casts a BUILTIN adds on top of an argument the IR already typed: `SHL`s `as u32`,
 * the math helpers `as f64`, the string helpers `as i64`.
 */
export function castTo(value: Printed, from: Type, target: string, constant?: IrExpr): Printed {
  // A CONSTANT IS CAST WHERE IT IS PRINTED (7.2.10): `4i64`, not `(4i8 as i64)` — when the target holds it exactly
  const typed = constant?.kind === "const" ? castLiteral(typeof constant.value === "number" && isReal32(from) ? Math.fround(constant.value) : constant.value, target) : undefined
  if (typed !== undefined) return typed
  return rustType(from) === target ? value : cast(value, rustType(from), target)
}

/** The widenings Rust has a `From` for — each keeps every value of its source (7.3.5). */
const LOSSLESS: Readonly<Record<string, readonly string[]>> = {
  u8: ["u16", "u32", "u64", "i16", "i32", "i64", "f32", "f64", "usize"],
  u16: ["u32", "u64", "i32", "i64", "f32", "f64", "usize"],
  u32: ["u64", "i64", "f64"],
  i8: ["i16", "i32", "i64", "f32", "f64"],
  i16: ["i32", "i64", "f32", "f64"],
  i32: ["i64", "f64"],
  f32: ["f64"],
  bool: ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "usize"],
}

/**
 * `value` (of the Rust type `from`) as a `target`: `target::from(value)` when that widening keeps every value, `value as
 * target` when it truncates or reinterprets (7.3.5: clippy's `cast_lossless` names every `as` of the first kind).
 */
export function cast(value: Printed, from: string, target: string): Printed {
  return LOSSLESS[from]?.includes(target) === true ? printed(`${target}::from(${at(value, Prec.Block)})`, Prec.Postfix) : printed(`${at(value, Prec.As)} as ${target}`, Prec.As)
}

/** A constant (a REAL's already its f32) as a literal of the Rust numeric type `target`, when that type holds it exactly
 *  (a negative one binds as a unary minus); undefined when it does not. */
function castLiteral(v: IrValue, target: string): Printed | undefined {
  const int = /^([iu])(8|16|32|64)$/.exec(target)
  const signedRange = (bits: number): [bigint, bigint] => [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n]
  let text: string | undefined
  if (typeof v === "bigint" && int !== null) {
    const bits = Number(int[2])
    const [lo, hi] = int[1] === "i" ? signedRange(bits) : [0n, (1n << BigInt(bits)) - 1n]
    if (v >= lo && v <= hi) text = `${v}${target}`
  } else if (typeof v === "bigint" && target === "f64" && v >= -(1n << 53n) && v <= 1n << 53n) {
    text = `${v}.0f64`
  } else if (typeof v === "number" && target === "f64" && Number.isFinite(v)) {
    text = `${Number.isInteger(v) ? `${v}.0` : `${v}`}f64`.replace(/^(-?\d+(?:\.\d+)?e[+-]?\d+)\.0f64$/, "$1f64")
  }
  if (text !== undefined) text = grouped(text)
  return text === undefined ? undefined : printed(text, text.startsWith("-") ? Prec.Unary : Prec.Postfix)
}

/** The result of an `f64` math routine, narrowed to the IEC type — or left alone when that type IS `f64`. */
export function fromF64(value: Printed, target: string): Printed {
  return target === "f64" ? value : printed(`${at(value, Prec.As)} as ${target}`, Prec.As)
}

/** Each temporal type's formatter (`runtime/text.ts`), by its canonical name. */
const TEMPORAL_TEXT: Readonly<Record<string, RuntimeId>> = {
  TIME: "iec_time_text",
  LTIME: "iec_ltime_text",
  DATE: "iec_date_text",
  DT: "iec_dt_text",
  TOD: "iec_tod_text",
  LDT: "iec_ldt_text",
  LDATE: "iec_ldate_text",
  LTOD: "iec_ltod_text",
}

/** The formatter of a temporal type — a name with none is a lowering bug, named. */
function temporalText(source: string): RuntimeId {
  const id = TEMPORAL_TEXT[source]
  if (id === undefined) throw new Error(`emit: no formatter for ${source}_TO_STRING`)
  return id
}

export function exprConvert(p: Printer, e: Extract<IrExpr, { kind: "convert" }>, slots: IrPou["slots"]): Printed {
  // The measured rules (design §11), each where Rust's bare `as` means something else: a float → int `as`
  // TRUNCATES and SATURATES, where CODESYS rounds half away from zero (`f64::round` is exactly that) and wraps
  // (through i64, then `as` between ints wraps); `as bool` does not exist; nor does `bool as f32`.
  const value = print(p, e.value, slots)
  const receiver = at(value, Prec.Postfix)
  const bare = at(value, Prec.Block)
  const from = emittedFamily(e.value.type)
  const to = emittedFamily(e.type)
  const target = rustType(e.type)
  // A CONVERSION TO THE RUST TYPE THE VALUE ALREADY HAS IS NOTHING. `WORD_TO_UINT` and `UINT_TO_WORD` are both
  // `u16 as u16`; so is every conversion between an alias and what it aliases. The printer emitted the cast
  // anyway — 578 of them across the fixtures, which is what `clippy::unnecessary_cast` names. STRING is
  // excluded because two `IecString`s of different capacity are a real copy, not a cast.
  if (from !== undefined && to !== undefined && from !== "string" && to !== "string" && rustType(e.value.type) === target)
    return value
  // STRING → STRING: the copy that truncates at the target's capacity, and across the two WIDTHS one code unit
  // per code unit (conformance `xo3_string_wide_conversions`).
  if (to === "string" || from === "string") use(p, "string")
  if (to === "string" && from === "string") {
    const target = stringType(e.type)
    const source = stringType(e.value.type)
    const how = target.name === source.name ? "to" : target.name === "IecString" ? "narrow" : "widen"
    return printed(`${receiver}.${how}::<${target.capacity}>()`, Prec.Postfix)
  }
  if (to === "string") {
    const source = e.value.type.kind === "elementary" ? e.value.type.name : ""
    // a formatter writes into the STRING it answers, at the target's capacity (`runtime/text.ts`, lean 9.4)
    const written = (id: RuntimeId, arg: string): Printed => {
      const target = stringType(e.type)
      if (target.name !== "IecString") throw new Error(`emit: ${source}_TO_${e.type.kind === "elementary" ? e.type.name : "?"} has no formatter`)
      return printed(`${use(p, id)}::<${target.capacity}>(${arg})`, Prec.Postfix)
    }
    // An LTIME is a u64 of nanoseconds and its helper takes it as one: through i64, 2^63 ns and past printed a negative
    // duration (transpile-review 32, `tr_32_fmt_ltime_past_i64`).
    if (isTemporal(source)) return written(temporalText(source), at(castTo(value, e.value.type, source === "LTIME" ? "u64" : "i64", e.value), Prec.Block))
    if (source === "LREAL") return written("iec_lreal_text", bare)
    const text = from === "bool" ? `(if ${bare} { "TRUE" } else { "FALSE" })` : `format!("{}", ${bare})`
    return printed(`${stringPath(e.type)}::lit(${text}.as_bytes())`, Prec.Postfix)
  }
  // the parse helpers already RETURN `f64` / `i64`; casting to the same type is `unnecessary_cast`
  if (from === "string") {
    // a WSTRING reaches a parse only into an integer — its own grammar (lowering narrows one parsed into a REAL)
    const wide = stringType(e.value.type).name !== "IecString"
    const parser = to === "real" ? "iec_parse_real" : wide ? "iec_parse_int_wide" : "iec_parse_int"
    // an integer parse is told whether its target is unsigned: a negative text into one is 0 (`wstring_parse_widths`)
    const unsigned = to === "real" ? "" : `, ${e.type.kind === "elementary" && e.type.elem.signed !== true}`
    const parsed = printed(`${use(p, parser)}(${receiver}.units()${unsigned})`, Prec.Postfix)
    return target === (to === "real" ? "f64" : "i64") ? parsed : printed(`${parsed.text} as ${target}`, Prec.As)
  }
  if (to === "bool") return from === "bool" ? value : printed(`${at(value, Prec.Compare + 1)} != ${from === "real" ? "0.0" : "0"}`, Prec.Compare)
  if (from === "bool") return to === "real" ? cast(cast(value, "bool", "u8"), "u8", target) : cast(value, "bool", target)
  // REAL -> INTEGER IS DONE AT THE DESTINATION'S REGISTER WIDTH, then wrapped into the target — the emitted
  // twin of `coerce` in the interpreter, where the 192 measured cells are set out. This went through a 64-bit
  // register for every destination, which is the one thing four measurements could not distinguish: a 32-bit
  // destination has its OWN indefinite, 0x80000000, and that is why `LREAL_TO_DINT(-1.0E30)` is -2147483648
  // and not 0. Rust's own `as` saturates, which is neither.
  if (from === "real" && to !== "real") {
    const wide = e.type.kind === "elementary" && e.type.elem.bits >= 64
    // the helper already RETURNS the register width; casting i32 to i32 is what `unnecessary_cast` names
    const helper = use(p, wide ? "iec_r2i64" : "iec_r2i32")
    const call = printed(`${helper}(${at(castTo(value, e.value.type, "f64", e.value), Prec.Block)})`, Prec.Postfix)
    return target === (wide ? "i64" : "i32") ? call : printed(`${call.text} as ${target}`, Prec.As)
  }
  // REAL <-> LREAL moves a NaN's payload as CODESYS does (`iec_widen` / `iec_narrow`, gate 8c): `f64::from` and `as f32`
  // leave a NaN to the compiler, which an optimized build folds into another one
  if (from === "real" && to === "real") return printed(`${use(p, target === "f64" ? "iec_widen" : "iec_narrow")}(${bare})`, Prec.Postfix)
  return cast(value, rustType(e.value.type), target)
}
