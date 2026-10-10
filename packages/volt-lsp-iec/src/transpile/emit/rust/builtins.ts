/** BUILTINS AS RUST — one printer per builtin name. */
import type { IrBuiltinName, IrExpr, IrMathName, IrPou } from "../../ir/index.js"
import { isReal } from "../../../frontend/types/index.js"
import { castTo, fromF64 } from "./convert.js"
import { expr, unparen } from "./expr.js"
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

export function exprBuiltin(p: Printer, e: Extract<IrExpr, { kind: "builtin" }>, slots: IrPou["slots"]): string {
  const args = e.args.map((a) => expr(p, a, slots))
  // ARGUMENT positions need none of the printer's parentheses; `args` keeps them because several of these
  // builtins use an argument as a RECEIVER, where `(-1i32).abs()` is not `-1i32.abs()`.
  const argv = args.map(unparen)
  const print = BUILTINS[e.name]
  // A BUILTIN THIS DOES NOT PRINT MUST STOP HERE. The inner switch had no default, so an unhandled name fell
  // OUT of it and straight into `case "unary"` below — which reads `e.operand`, a field a builtin node does
  // not have. The result was `undefined` spliced into the emitted Rust, for a name nobody had noticed adding.
  if (print === undefined) throw new Error(`emit: no Rust for the builtin ${e.name}`)
  return print(e, args, argv, p)
}

/** A builtin's printer: the node, its arguments as printed (`args`, receiver-safe) and unparenthesized (`argv`). */
type BuiltinPrinter = (e: Extract<IrExpr, { kind: "builtin" }>, args: readonly string[], argv: readonly string[], p: Printer) => string

// A STRING has no `Ord`, only the cross-length `PartialOrd` the prelude defines, so `.max()` does not
// resolve on one (E0599 — the error that had MAX over a STRING refused in the first place). `iec_max`
// and `iec_min` need only that `PartialOrd`, and pick the same operand the interpreter's `ord` does.
// A REAL is `iec_fmax` / `iec_fmin`, CODESYS's compare-select — the SECOND argument on a tie or a NaN — where
// f32::max drops the NaN and answers either zero (`tr_28_minmax_limit_nan_signed_zero_*`, recorded as bits).
const maxMin: BuiltinPrinter = (e, args, argv, p) =>
  isString(e.type)
    ? args.reduce((acc, a) => `${use(p, e.name === "max" ? "iec_max" : "iec_min")}(${acc}, ${a})`)
    : isReal(e.type)
      ? argv.reduce((acc, a) => `${use(p, e.name === "max" ? "iec_fmax" : "iec_fmin")}(${acc}, ${a})`)
      : args.reduce((acc, a) => `${acc}.${e.name}(${unparen(a)})`)

// Rust's own features, each proven to match at the edges (design §13, §14): `wrapping_shl`/`wrapping_shr`
// mask the count to the width's bits exactly as CODESYS does and shift a signed value arithmetically;
// `rotate_left`/`rotate_right` take the count modulo the width.
const shift: BuiltinPrinter = (e, args) => {
  const count = constCount(e.args[1]!)
  // a constant count prints bare, and a shift by 0 is its operand (a partial access `.%B0`, lean 2.4)
  if (count === 0n) return args[0]!
  return `${args[0]}.wrapping_${e.name}(${count ?? unparen(castTo(args[1]!, e.args[1]!.type, "u32", e.args[1]))})`
}

/** A character position that is a non-negative constant — printed bare where the parameter is an `i64`. */
const constPosition = (at: IrExpr): bigint | undefined => (at.kind === "const" && typeof at.value === "bigint" && at.value >= 0n && at.value < 1n << 63n ? at.value : undefined)

/** A shift or rotate count that is a constant a `u32` holds — printed bare, Rust reads it as the `u32` the call takes. */
const constCount = (count: IrExpr): bigint | undefined =>
  count.kind === "const" && typeof count.value === "bigint" && count.value >= 0n && count.value < 1n << 32n ? count.value : undefined

// With `bits`, the LOW bits rotate as a `u8`/`u16` and the promoted bits above them are kept (`IrBuiltin.bits`).
const rotate: BuiltinPrinter = (e, args, argv) => {
  const rotate = `rotate_${e.name === "rol" ? "left" : "right"}(${constCount(e.args[1]!) ?? unparen(castTo(args[1]!, e.args[1]!.type, "u32", e.args[1]))})`
  if (e.bits === undefined) return `${args[0]}.${rotate}`
  return `({ let ${tmp("rot")} = ${argv[0]}; (${tmp("rot")} & !${(1n << BigInt(e.bits)) - 1n}) | ((${tmp("rot")} as u${e.bits}).${rotate} as ${rustType(e.type)}) })`
}

// The emitted twin of `MATH`'s `logarithm` guard: `LN(0)` and `LOG(0)` stop the task on CODESYS, and Rust
// answers `-inf` and carries on. Nothing else in this group stops anything — `EXP(1000)` is an infinity
// and runs. Measured in `operators/math-domain.ts`.
const logarithm: BuiltinPrinter = (e, args, _argv, p) =>
  fromF64(`${use(p, "iec_log")}(${unparen(castTo(args[0]!, e.args[0]!.type, "f64", e.args[0]))}).${RUST_MATH[e.name as IrMathName]}()`, rustType(e.type))

// through f64 and back, the same path the interpreter takes — `f32::ln` is a different float32 routine
const math: BuiltinPrinter = (e, args) => fromF64(`${castTo(args[0]!, e.args[0]!.type, "f64", e.args[0])}.${RUST_MATH[e.name as IrMathName]}()`, rustType(e.type))

/** Every builtin's printer, by name. */
const BUILTINS: Readonly<Record<IrBuiltinName, BuiltinPrinter>> = {
  max: maxMin,
  min: maxMin,
  // NOT `clamp`: Rust's panics when MN > MX, and CODESYS answers that case with MX for every IN (conformance
  // `limit_inverted_bounds`). MIN(MAX(MN, IN), MX) is exactly the measured behaviour — MN as the receiver, so
  // it is evaluated before IN, as the IR states (`tr_41_limit_evaluation_order`).
  limit: (e, args, argv, p) =>
    isString(e.type)
      ? `${use(p, "iec_min")}(${use(p, "iec_max")}(${args[0]}, ${args[1]}), ${args[2]})`
      : isReal(e.type)
        ? `${use(p, "iec_fmin")}(${use(p, "iec_fmax")}(${argv[0]}, ${argv[1]}), ${argv[2]})`
        : `${args[0]}.max(${argv[1]}).min(${argv[2]})`,
  // LAZY, as the IR states: only the selected input is evaluated (`tr_41_sel_side_effects`).
  sel: (_e, _args, argv) => `(if ${argv[0]} { ${argv[2]} } else { ${argv[1]} })`,
  // Toward zero into an i32 whose out-of-range (and NaN) answer is i32::MIN — CODESYS's TRUNC(3.0E9) is
  // -2147483648, not a wrap and not Rust's saturating `as` (`runtime/numeric.ts` `iec_trunc_i32`) — then `as` wraps
  // that into INT for TRUNC_INT.
  trunc: (e, args, _argv, p) => {
    const call = `${use(p, "iec_trunc_i32")}(${unparen(castTo(args[0]!, e.args[0]!.type, "f64", e.args[0]))})`
    return rustType(e.type) === "i32" ? call : `(${call} as ${rustType(e.type)})`
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
    return `(match ${k} { ${arms.join(", ")} })`
  },
  // `iec_pow`: EXPT(0, finite negative) stops the task on CODESYS, where `powf` answers inf (`semantics/math.ts` `expt`)
  expt: (e, args, _argv, p) =>
    fromF64(`${use(p, "iec_pow")}(${unparen(castTo(args[0]!, e.args[0]!.type, "f64", e.args[0]))}, ${unparen(castTo(args[1]!, e.args[1]!.type, "f64", e.args[1]))})`, rustType(e.type)),
  // `abs` would panic on a signed minimum in a debug build; an unsigned operand never reaches here — ABS of one is the
  // operand itself, decided in lowering (7.3.4)
  abs: (e, args) => (isReal(e.type) ? `${args[0]}.abs()` : `${args[0]}.wrapping_abs()`),
  // a constant position prints bare: the parameter is an i64 (7.2.3)
  char: (e, args) => `${args[0]}.char_at(${constPosition(e.args[1]!) ?? unparen(castTo(args[1]!, e.args[1]!.type, "i64", e.args[1]))})`,
  setchar: (e, args, argv) => `${args[0]}.with_char(${constPosition(e.args[1]!) ?? unparen(castTo(args[1]!, e.args[1]!.type, "i64", e.args[1]))}, ${argv[2]})`,
  // two addresses ordered inside one region of the image, or the fault (`runtime/pointer.ts` `Mem::order`)
  address_order: (_e, _args, argv, p) => `${mem(p, "order")}(${argv[0]}, ${argv[1]})`,
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
