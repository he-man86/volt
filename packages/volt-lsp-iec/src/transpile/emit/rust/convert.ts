/** CONVERSIONS AS RUST — the `convert` node by the measured rules (design §11), and the casts a builtin adds. */
import type { IrExpr, IrPou } from "../../ir/index.js"
import { isTemporal, type Type } from "../../../frontend/types/index.js"
import { expr, unparen } from "./expr.js"
import type { Printer } from "./printer.js"
import { emittedFamily, rustType, stringPath, stringType } from "./types.js"

/**
 * `text as target`, or `text` unchanged when it already IS that Rust type — the twin of the identity rule in
 * `convert`, for the casts a BUILTIN adds on top of an argument the IR already typed: `SHL`s `as u32`, the math
 * helpers `as f64`, the string helpers `as i64`. Parenthesized when it does cast, because every one of these
 * lands in a receiver or an argument position.
 */
export function castTo(text: string, from: Type, target: string): string {
  return rustType(from) === target ? text : `(${text} as ${target})`
}

/** The result of an `f64` math routine, narrowed to the IEC type — or left alone when that type IS `f64`. */
export function fromF64(text: string, target: string): string {
  return target === "f64" ? text : `(${text} as ${target})`
}

export function exprConvert(p: Printer, e: Extract<IrExpr, { kind: "convert" }>, slots: IrPou["slots"]): string {
  // The measured rules (design §11), each where Rust's bare `as` means something else: a float → int `as`
  // TRUNCATES and SATURATES, where CODESYS rounds half away from zero (`f64::round` is exactly that) and wraps
  // (through i64, then `as` between ints wraps); `as bool` does not exist; nor does `bool as f32`.
  const value = expr(p, e.value, slots)
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
  if (to === "string" && from === "string") {
    const target = stringType(e.type)
    const source = stringType(e.value.type)
    const how = target.name === source.name ? "to" : target.name === "IecString" ? "narrow" : "widen"
    return `${value}.${how}::<${target.capacity}>()`
  }
  if (to === "string") {
    const source = e.value.type.kind === "elementary" ? e.value.type.name : ""
    const text =
      from === "bool"
        ? `(if ${unparen(value)} { "TRUE" } else { "FALSE" })`
        : isTemporal(source)
          ? // An LTIME is a u64 of nanoseconds and its helper takes it as one: through i64, 2^63 ns and past
            // printed a negative duration (transpile-review 32, `tr_32_fmt_ltime_past_i64`).
            `iec_${source.toLowerCase()}_text(${unparen(castTo(value, e.value.type, source === "LTIME" ? "u64" : "i64"))})`
          : source === "LREAL"
            ? `iec_lreal_text(${unparen(value)})`
            : `format!("{}", ${unparen(value)})`
    return `${stringPath(e.type)}::lit(${text}.as_bytes())`
  }
  // the parse helpers already RETURN `f64` / `i64`; casting to the same type is `unnecessary_cast`
  if (from === "string") {
    const parsed = `iec_parse_${to === "real" ? "real" : "int"}(${value}.units())`
    return target === (to === "real" ? "f64" : "i64") ? parsed : `(${parsed} as ${target})`
  }
  if (to === "bool") return from === "bool" ? value : from === "real" ? `(${value} != 0.0)` : `(${value} != 0)`
  if (from === "bool") return to === "real" ? `((${value} as u8) as ${target})` : `(${value} as ${target})`
  // REAL -> INTEGER IS DONE AT THE DESTINATION'S REGISTER WIDTH, then wrapped into the target — the emitted
  // twin of `coerce` in the interpreter, where the 192 measured cells are set out. This went through a 64-bit
  // register for every destination, which is the one thing four measurements could not distinguish: a 32-bit
  // destination has its OWN indefinite, 0x80000000, and that is why `LREAL_TO_DINT(-1.0E30)` is -2147483648
  // and not 0. Rust's own `as` saturates, which is neither.
  if (from === "real" && to !== "real") {
    const wide = e.type.kind === "elementary" && e.type.elem.bits >= 64
    // the helper already RETURNS the register width; casting i32 to i32 is what `unnecessary_cast` names
    const helper = wide ? "iec_r2i64" : "iec_r2i32"
    const call = `${helper}(${unparen(castTo(value, e.value.type, "f64"))})`
    return target === (wide ? "i64" : "i32") ? call : `(${call} as ${target})`
  }
  return `(${value} as ${target})`
}
