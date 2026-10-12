/**
 * THE CONSTANT CALLS — the conversions, the pure built-ins and SIZEOF, as CODESYS folds them where a constant is
 * required. Split from `fold.ts` (openspec lsp-same-standard design.md §2.2).
 */
import { lookup, rootOf, type Scope, targetOf } from "../../symbols/index.js"
import type { Expr, CallExpr } from "../../syntax/index.js"
import { parseConversionName } from "../conversion-name.js"
import { type ElementaryType, elementaryType } from "../elementary.js"
import { sizeofOperandBytes } from "../infer/sizeof.js"
import { wrapToWidth } from "../width.js"
import {
  type FoldContext,
  type Folded,
  UNKNOWN_VALUE,
  expecting,
  fold,
  meetAll,
  type RealWidth,
  integerTypeOf,
} from "./fold.js"

// ─── calls: the conversions, the pure built-ins, SIZEOF ───────────────────────────────────────────────────────────

/** The built-ins a constant expression may call, folded below — everything else (a user function, ADR, a math function not
 *  listed) is no constant this decides. */
const FOLDED_BUILTINS: ReadonlySet<string> = new Set(["ABS", "MIN", "MAX", "LIMIT", "SEL", "MUX", "SHL", "SHR", "ROL", "ROR", "TRUNC", "EXPT", "SQRT", "SIZEOF"])

/** The SIZEOF operands being sized, across every fold the sizing starts, and whether the sizing reached itself — see `call`. */
const sizing = new Map<Expr, { reached: boolean }>()

export function call(expr: CallExpr, scope: Scope, ctx: FoldContext): Folded {
  if (expr.callee.kind !== "ident_expr") return UNKNOWN_VALUE
  const name = expr.callee.name
  // a name the project declares is ITS function, not the built-in: user code can shadow a built-in name
  if (lookup(scope, name) !== undefined) return UNKNOWN_VALUE
  const upper = name.toUpperCase()
  if (upper === "SIZEOF") {
    const operand = expr.args.length === 1 ? expr.args[0]?.value : undefined
    // its operand's type folds that type's bounds, a fold of their own (a fresh context): a size that reaches itself
    // through one (`a : ARRAY[0..SIZEOF(a)]`, `c := SIZEOF(arr)` with `arr : ARRAY[0..c]`) has no size — it recursed
    // until the stack overflowed, and the file got no diagnostics at all (step 4d review). The OUTER size has none either:
    // `x : INT (0..SIZEOF(x))` sized x as an INT(0..2), a range CODESYS never computed (step 4d review 2)
    if (operand === undefined) return { value: undefined, constancy: "constant" }
    const inside = sizing.get(operand)
    if (inside !== undefined) {
      inside.reached = true
      return { value: undefined, constancy: "constant" }
    }
    const self = { reached: false }
    sizing.set(operand, self)
    try {
      const bytes = sizeofOperandBytes(operand, scope, rootOf(scope))
      return bytes === undefined || self.reached ? { value: undefined, constancy: "constant" } : { value: bytes, constancy: "constant" }
    } finally {
      sizing.delete(operand)
    }
  }
  const conversion = parseConversionName(name, targetOf(rootOf(scope)))
  if (conversion === undefined && !FOLDED_BUILTINS.has(upper)) return UNKNOWN_VALUE
  // positional arguments only — a named or output one is no call this folds
  if (expr.args.some((a) => a.param !== undefined || a.output || a.value === undefined)) return UNKNOWN_VALUE
  // a shift's operand takes what the call's context expects when it is an untyped literal (`FoldContext.expected`);
  // anything else — a conversion's argument, a NOT under the shift — nothing: unmeasured (step 4d review 2)
  const args = expr.args.map((a, i) =>
    conversion !== undefined
      ? converted(a.value!, scope, expecting(ctx, undefined))
      : fold(a.value!, scope, literalOnly(a.value!, expecting(ctx, shiftContext(upper, i, ctx.expected)))),
  )
  const constancy = meetAll(args)
  const result = conversion !== undefined ? (args.length === 1 ? convert(args[0]!, conversion.to) : undefined) : builtin(upper, args)
  return result === undefined ? { value: undefined, constancy } : { ...result, constancy }
}

/** `ctx` for an operand of NOT or a shift: its context type reaches an untyped LITERAL there, nothing nested deeper. */
export const literalOnly = (operand: Expr, ctx: FoldContext): FoldContext => (operand.kind === "literal" ? ctx : expecting(ctx, undefined))

/** The integer type a non-conversion's argument `i` takes as an untyped literal: a shift's operand, the context's — see `call`. */
function shiftContext(name: string, i: number, expected: ElementaryType | undefined): ElementaryType | undefined {
  return i === 0 && (name === "SHL" || name === "SHR" || name === "ROL" || name === "ROR") ? expected : undefined
}

/** A CONVERSION's argument folded — a duration literal as its type's ticks (TIME milliseconds, LTIME nanoseconds), which
 *  only a conversion reads (`TIME_TO_DINT(T#5MS)` is 5, `ce_fold_conversion_bound_time`; `cfold_time_to_dint` 1500). Any
 *  other call of one yields a TIME, which no fold here holds: `MAX(T#1S, T#2S)` folded to the bare 2000 (step 4d review). */
function converted(e: Expr, scope: Scope, ctx: FoldContext): Folded {
  if (e.kind === "literal" && e.literalKind === "time" && typeof e.value === "object" && e.value !== null && "ns" in e.value) {
    const t = elementaryType(/^LTIME#/i.test(e.text) ? "LTIME" : "TIME")!
    return { value: e.value.ns / t.tickNs!, constancy: "constant", elem: t }
  }
  return fold(e, scope, ctx)
}

type Result = Omit<Folded, "constancy">

/**
 * An explicit conversion into `to`: an integer target wraps (`INT_TO_USINT(300)` is 44, `INT_TO_SINT(200)` -56), a REAL
 * source rounds half away from zero (`REAL_TO_INT(2.5)` 3, -2.5 -3) at the destination's register (below), BOOL is 1 or 0
 * and an integer into BOOL is "not zero", an integer into a REAL is the number (`ce_fold_conversion_bound_*`, `cfold_*`).
 * A target or source of any other family is not folded.
 */
function convert(arg: Folded, to: ElementaryType): Result | undefined {
  const v = arg.value
  if (v === undefined) return undefined
  if (to.family === "bool") return { value: typeof v === "boolean" ? v : typeof v === "bigint" ? v !== 0n : v !== 0 }
  if (to.family === "real") {
    const n = typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? exactNumber(v) : v
    if (n === undefined) return undefined
    return to.bits === 32 ? { value: Math.fround(n), width: 32 } : { value: n, width: 64 }
  }
  if ((to.family !== "int" && to.family !== "bitstring") || to.rank === undefined) return undefined
  const integer = typeof v === "boolean" ? (v ? 1n : 0n) : typeof v === "bigint" ? v : realToInteger(v, to.bits)
  return integer === undefined ? undefined : { value: wrapToWidth(integer, to), elem: to }
}

/** A bigint as a number when it is one exactly — the larger integers round, which no measured fold has asked for. */
function exactNumber(v: bigint): number | undefined {
  return v >= -(2n ** 53n) && v <= 2n ** 53n ? Number(v) : undefined
}

/**
 * REAL → INTEGER, as measured in full (conformance `conversions/real-to-integer.ts`, `real-to-integer-ladder.ts`, the 192
 * cells the transpiler's `coerce` reproduces): rounded half away from zero, then converted at the DESTINATION's register —
 * 64-bit for a 64-bit destination, 32-bit for everything else — which the caller wraps into the declared type. A NaN is the
 * register's indefinite (i64::MIN, or 0); past the register: 64-bit ≥ 2^64 or < -2^63 i64::MIN; 32-bit ≥ 2^63 is 0 and
 * below -2^31 is -2^31 (`REAL_TO_DINT(3.0E9)` -1294967296, `cfold_real_to_int_out`).
 */
function realToInteger(n: number, bits: number): bigint | undefined {
  const wide = bits >= 64
  const I64_MIN = -(2n ** 63n)
  const I32_MIN = -(2n ** 31n)
  if (Number.isNaN(n)) return wide ? I64_MIN : 0n
  const rounded = Math.sign(n) * Math.round(Math.abs(n))
  if (!Number.isFinite(rounded)) return wide ? I64_MIN : rounded > 0 ? 0n : I32_MIN
  const r = BigInt(rounded)
  if (wide) return r >= 2n ** 64n || r < I64_MIN ? I64_MIN : BigInt.asIntN(64, r)
  if (r >= 2n ** 63n) return 0n
  if (r < I32_MIN) return I32_MIN
  return BigInt.asIntN(32, r)
}

/** A pure built-in over folded arguments (`ce_fold_builtin_bound_*`, `ce_fold_shl*`/`shr`/`rol`/`ror`, `cfold_*`). */
function builtin(name: string, args: readonly Folded[]): Result | undefined {
  const values = args.map((a) => a.value)
  if (values.some((v) => v === undefined)) return undefined
  const numbers = values.every((v) => typeof v === "bigint" || typeof v === "number")
  const pick = (i: number): Result => withType(args[i]!)
  switch (name) {
    case "ABS": {
      const v = values[0]
      if (args.length !== 1 || (typeof v !== "bigint" && typeof v !== "number")) return undefined
      const abs = typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(v)
      return { ...withType(args[0]!), value: typeof abs === "bigint" && args[0]!.elem !== undefined ? wrapToWidth(abs, args[0]!.elem) : abs }
    }
    case "MIN":
    case "MAX": {
      if (args.length < 2 || !numbers) return undefined
      // the SECOND on a tie, as the transpiler's `builtinValue` (`MAX(a, b)` is `IF a > b THEN a ELSE b`)
      let at = 0
      for (let i = 1; i < args.length; i++) at = (name === "MAX" ? (values[at] as number) > (values[i] as number) : (values[at] as number) < (values[i] as number)) ? at : i
      return pick(at)
    }
    case "LIMIT": {
      if (args.length !== 3 || !numbers) return undefined
      const [mn, v, mx] = values as (bigint | number)[]
      const low = mn! > v! ? 0 : 1
      return pick((low === 0 ? mn! : v!) < mx! ? low : 2)
    }
    case "SEL": {
      const g = values[0]
      return args.length === 3 && typeof g === "boolean" ? pick(g ? 2 : 1) : undefined
    }
    case "MUX": {
      const k = values[0]
      if (args.length < 2 || typeof k !== "bigint") return undefined
      // an out-of-range K, negative included, picks the LAST input (conformance `mux_out_of_range`)
      return pick(k >= 0n && k < BigInt(args.length - 1) ? Number(k) + 1 : args.length - 1)
    }
    case "SHL":
    case "SHR":
    case "ROL":
    case "ROR":
      return shift(name, args)
    case "TRUNC": {
      // toward zero, a DINT (`cfold_trunc` 7); beyond DINT's range unmeasured
      const v = values[0]
      if (args.length !== 1 || typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= 2 ** 31) return undefined
      return { value: BigInt(Math.trunc(v)), elem: elementaryType("DINT")! }
    }
    case "EXPT": {
      // REAL only when both arguments are REAL, LREAL otherwise (`builtins` `exptResultType`)
      if (args.length !== 2 || !numbers) return undefined
      const width: RealWidth = args[0]!.width === 32 && args[1]!.width === 32 ? 32 : 64
      const p = Math.pow(Number(values[0]), Number(values[1]))
      return { value: width === 32 ? Math.fround(p) : p, width }
    }
    case "SQRT": {
      // the argument's own REAL type, else LREAL (`builtins` `mathResultType`)
      if (args.length !== 1 || !numbers) return undefined
      const width: RealWidth = args[0]!.width ?? 64
      const r = Math.sqrt(Number(values[0]))
      return { value: width === 32 ? Math.fround(r) : r, width }
    }
  }
  return undefined
}

/** A folded value with the type it carries. */
function withType(f: Folded): Result {
  const r: Result = { value: f.value }
  if (f.width !== undefined) r.width = f.width
  if (f.elem !== undefined) r.elem = f.elem
  return r
}

/**
 * A SHIFT OR ROTATION HAPPENS AT ITS OPERAND'S WIDTH: `SHL(BYTE#255, 1)` is 254, `ROL(BYTE#129, 1)` 3, `ROR(BYTE#129, 1)`
 * 192, `SHR(WORD#80, 4)` 5, and an untyped literal shifts at its narrowest type (`SHL(1, 3)` 8) — `ce_fold_sh*`, `ce_fold_ro*`,
 * both vendors 2026-10-03. The result is of the operand's type. The bits are the operand's whole non-negative value — a
 * constant HELD past its type (`B : BYTE := KB + 1`, 256) shifts and rotates as held, cut to its declared width after:
 * ROL(B, 1) is (512 OR 2) cut to 8 bits, 2, ROR(B, 1) 128, SHR(B, 1) 128 (`tr_a29_rol_bound_widened_byte_constant`, both
 * vendors, `tr_a29_widened_constant_reads`; 6Af gate review) — and a negative one its pattern in that width.
 */
function shift(name: string, args: readonly Folded[]): Result | undefined {
  const [operand, count] = args
  if (args.length !== 2 || typeof operand!.value !== "bigint" || typeof count!.value !== "bigint" || count!.value < 0n) return undefined
  const e = integerTypeOf(operand!)
  if (e === undefined) return undefined
  const bits = BigInt(e.bits)
  const pattern = operand!.value >= 0n ? operand!.value : BigInt.asUintN(e.bits, operand!.value)
  const n = count!.value
  const r =
    name === "SHL" ? pattern << n
    : name === "SHR" ? pattern >> n
    : name === "ROL" ? (pattern << n % bits) | (pattern >> ((bits - (n % bits)) % bits))
    : (pattern >> n % bits) | (pattern << ((bits - (n % bits)) % bits))
  return { value: wrapToWidth(r, e), elem: e }
}
