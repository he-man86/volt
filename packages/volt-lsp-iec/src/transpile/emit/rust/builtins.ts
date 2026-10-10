/** BUILTINS AS RUST — one printer per builtin name. */
import type { IrBuiltinName, IrExpr, IrMathName, IrPou } from "../../ir/index.js"
import { isReal } from "../../../frontend/types/index.js"
import { castTo, fromF64 } from "./convert.js"
import { print } from "./expr.js"
import { at, Prec, printed, type Printed } from "./precedence.js"
import { mem } from "./image.js"
import { tmp } from "./names.js"
import { type Printer, use } from "./printer.js"
import { isString, rustType } from "./types.js"

/** The one-argument math functions → their `f64` method. LOG is base 10 in IEC. */
const RUST_MATH: Readonly<Record<IrMathName, string>> = {
  sqrt: "sqrt",
  ln: "ln",
  log: "log10",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
}

export function exprBuiltin(p: Printer, e: Extract<IrExpr, { kind: "builtin" }>, slots: IrPou["slots"]): Printed {
  const raw = e.args.map((a) => print(p, a, slots))
  // an argument as a RECEIVER (`args`), where `(-1i32).abs()` is not `-1i32.abs()`, or standing alone (`argv`)
  const args = raw.map((a) => at(a, Prec.Postfix))
  const argv = raw.map((a) => at(a, Prec.Block))
  const printer = BUILTINS[e.name]
  // A BUILTIN THIS DOES NOT PRINT MUST STOP HERE. The inner switch had no default, so an unhandled name fell
  // OUT of it and straight into `case "unary"` below — which reads `e.operand`, a field a builtin node does
  // not have. The result was `undefined` spliced into the emitted Rust, for a name nobody had noticed adding.
  if (printer === undefined) throw new Error(`emit: no Rust for the builtin ${e.name}`)
  return printer(e, args, argv, p, raw)
}

/** A builtin's printer: the node, its arguments as receivers (`args`), standing alone (`argv`) and as printed (`raw`). */
type BuiltinPrinter = (e: Extract<IrExpr, { kind: "builtin" }>, args: readonly string[], argv: readonly string[], p: Printer, raw: readonly Printed[]) => Printed

/** A call or a method chain: it binds as tightly as anything. */
const call = (text: string): Printed => printed(text, Prec.Postfix)
/** `castTo`'s answer standing alone — an argument. */
const arg = (r: Printed): string => at(r, Prec.Block)

// A STRING has no `Ord`, only the cross-length `PartialOrd` the prelude defines, so `.max()` does not
// resolve on one (E0599 — the error that had MAX over a STRING refused in the first place). `iec_max`
// and `iec_min` need only that `PartialOrd`, and pick the same operand the interpreter's `ord` does.
// A REAL is `iec_fmax` / `iec_fmin`, CODESYS's compare-select — the SECOND argument on a tie or a NaN — where
// f32::max drops the NaN and answers either zero (`tr_28_minmax_limit_nan_signed_zero_*`, recorded as bits).
const maxMin: BuiltinPrinter = (e, args, argv, p) =>
  call(
    isString(e.type) || isReal(e.type)
      ? argv.reduce((acc, a) => `${use(p, isString(e.type) ? (e.name === "max" ? "iec_max" : "iec_min") : e.name === "max" ? "iec_fmax" : "iec_fmin")}(${acc}, ${a})`)
      : argv.slice(1).reduce((acc, a) => `${acc}.${e.name}(${a})`, args[0]!),
  )

// Rust's own features, each proven to match at the edges (design §13, §14): `wrapping_shl`/`wrapping_shr`
// mask the count to the width's bits exactly as CODESYS does and shift a signed value arithmetically;
// `rotate_left`/`rotate_right` take the count modulo the width.
const shift: BuiltinPrinter = (e, args, _argv, _p, raw) => {
  const count = constCount(e.args[1]!)
  // a constant count prints bare, and a shift by 0 is its operand (a partial access `.%B0`, lean 2.4)
  if (count === 0n) return raw[0]!
  return call(`${args[0]}.wrapping_${e.name}(${count ?? arg(castTo(raw[1]!, e.args[1]!.type, "u32", e.args[1]))})`)
}

/** A character position that is a non-negative constant — printed bare where the parameter is an `i64`. */
const constPosition = (at: IrExpr): bigint | undefined => (at.kind === "const" && typeof at.value === "bigint" && at.value >= 0n && at.value < 1n << 63n ? at.value : undefined)

/** A shift or rotate count that is a constant a `u32` holds — printed bare, Rust reads it as the `u32` the call takes. */
const constCount = (count: IrExpr): bigint | undefined =>
  count.kind === "const" && typeof count.value === "bigint" && count.value >= 0n && count.value < 1n << 32n ? count.value : undefined

// With `bits`, the LOW bits rotate as a `u8`/`u16` and the promoted bits above them are kept (`IrBuiltin.bits`).
const rotate: BuiltinPrinter = (e, args, argv, _p, raw) => {
  const rotate = `rotate_${e.name === "rol" ? "left" : "right"}(${constCount(e.args[1]!) ?? arg(castTo(raw[1]!, e.args[1]!.type, "u32", e.args[1]))})`
  if (e.bits === undefined) return call(`${args[0]}.${rotate}`)
  return call(`{ let ${tmp("rot")} = ${argv[0]}; (${tmp("rot")} & !${(1n << BigInt(e.bits)) - 1n}) | ((${tmp("rot")} as u${e.bits}).${rotate} as ${rustType(e.type)}) }`)
}

// The emitted twin of `MATH`'s `logarithm` guard: `LN(0)` and `LOG(0)` stop the task on CODESYS, and Rust
// answers `-inf` and carries on. Nothing else in this group stops anything — `EXP(1000)` is an infinity
// and runs. Measured in `operators/math-domain.ts`.
const logarithm: BuiltinPrinter = (e, _args, _argv, p, raw) =>
  fromF64(call(`${use(p, "iec_log")}(${arg(castTo(raw[0]!, e.args[0]!.type, "f64", e.args[0]))}).${RUST_MATH[e.name as IrMathName]}()`), rustType(e.type))

// through f64 and back, the same path the interpreter takes — `f32::ln` is a different float32 routine: over all 2^32 REAL
// inputs `f32::exp` differs from the f64 round trip on 23,280, `ln` 210,637, `log10` 2,418,508, `sin` 2,866,998, `cos`
// 2,876,136, `tan` 480,626, `asin` 2,352,772, `acos` 693,829, `atan` 3,532 (7.3.12, measured 2026-10-10 on this platform's
// libm) — but SQRT on a REAL is `f32::sqrt`: IEEE sqrt rounds correctly, and f64 holds 53 >= 2·24 + 2 bits, so the round
// trip's double rounding is innocuous — 0 of 2^32 inputs differ (7.3.6; the twins in `runtime-twins.test.ts` hold it)
const math: BuiltinPrinter = (e, args, _argv, _p, raw) =>
  e.name === "sqrt" && rustType(e.type) === "f32"
    ? call(`${args[0]}.sqrt()`)
    : fromF64(call(`${at(castTo(raw[0]!, e.args[0]!.type, "f64", e.args[0]), Prec.Postfix)}.${RUST_MATH[e.name as IrMathName]}()`), rustType(e.type))

/** Every builtin's printer, by name. */
const BUILTINS: Readonly<Record<IrBuiltinName, BuiltinPrinter>> = {
  max: maxMin,
  min: maxMin,
  // NOT `clamp`: Rust's panics when MN > MX, and CODESYS answers that case with MX for every IN (conformance
  // `limit_inverted_bounds`). MIN(MAX(MN, IN), MX) is exactly the measured behaviour — MN as the receiver, so
  // it is evaluated before IN, as the IR states (`tr_41_limit_evaluation_order`).
  limit: (e, args, argv, p) =>
    call(
      isString(e.type)
        ? `${use(p, "iec_min")}(${use(p, "iec_max")}(${argv[0]}, ${argv[1]}), ${argv[2]})`
        : isReal(e.type)
          ? `${use(p, "iec_fmin")}(${use(p, "iec_fmax")}(${argv[0]}, ${argv[1]}), ${argv[2]})`
          : `${args[0]}.max(${argv[1]}).min(${argv[2]})`,
    ),
  // LAZY, as the IR states: only the selected input is evaluated (`tr_41_sel_side_effects`).
  sel: (_e, _args, argv) => printed(`if ${argv[0]} { ${argv[2]} } else { ${argv[1]} }`, Prec.Block),
  // Toward zero into an i32 whose out-of-range (and NaN) answer is i32::MIN — CODESYS's TRUNC(3.0E9) is
  // -2147483648, not a wrap and not Rust's saturating `as` (`runtime/numeric.ts` `iec_trunc_i32`) — then `as` wraps
  // that into INT for TRUNC_INT.
  trunc: (e, _args, _argv, p, raw) => {
    const truncated = `${use(p, "iec_trunc_i32")}(${arg(castTo(raw[0]!, e.args[0]!.type, "f64", e.args[0]))})`
    return rustType(e.type) === "i32" ? call(truncated) : printed(`${truncated} as ${rustType(e.type)}`, Prec.As)
  },
  shl: shift,
  shr: shift,
  rol: rotate,
  ror: rotate,
  mux: (_e, _args, argv) => {
    // LAZY, as the IR states: a `match` evaluates only the selected arm (`tr_41_mux_side_effects`).
    // a match ARM stands alone; the printer's parentheses around each one are `unused_parens`
    const [k, ...inputs] = argv
    const arms = inputs.map((input, i) => (i === inputs.length - 1 ? `_ => ${input}` : `${i} => ${input}`))
    return printed(`match ${k} { ${arms.join(", ")} }`, Prec.Block)
  },
  // `iec_pow`: EXPT(0, finite negative) stops the task on CODESYS, where `powf` answers inf (`semantics/math.ts` `expt`)
  expt: (e, _args, _argv, p, raw) =>
    fromF64(call(`${use(p, "iec_pow")}(${arg(castTo(raw[0]!, e.args[0]!.type, "f64", e.args[0]))}, ${arg(castTo(raw[1]!, e.args[1]!.type, "f64", e.args[1]))})`), rustType(e.type)),
  // `abs` would panic on a signed minimum in a debug build; an unsigned operand never reaches here — ABS of one is the
  // operand itself, decided in lowering (7.3.4)
  abs: (e, args) => call(isReal(e.type) ? `${args[0]}.abs()` : `${args[0]}.wrapping_abs()`),
  // a constant position prints bare: the parameter is an i64 (7.2.3)
  char: (e, args, _argv, _p, raw) => call(`${args[0]}.char_at(${constPosition(e.args[1]!) ?? arg(castTo(raw[1]!, e.args[1]!.type, "i64", e.args[1]))})`),
  setchar: (e, args, argv, _p, raw) => call(`${args[0]}.with_char(${constPosition(e.args[1]!) ?? arg(castTo(raw[1]!, e.args[1]!.type, "i64", e.args[1]))}, ${argv[2]})`),
  // two addresses ordered inside one region of the image, or the fault (`runtime/pointer.ts` `Mem::order`)
  address_order: (_e, _args, argv, p) => call(`${mem(p, "order")}(${argv[0]}, ${argv[1]})`),
  ln: logarithm,
  log: logarithm,
  sqrt: math,
  exp: math,
  sin: math,
  cos: math,
  tan: math,
  asin: math,
  acos: math,
  atan: math,
}
