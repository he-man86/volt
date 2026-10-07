/** THE MATH FUNCTIONS: the one-argument table (LN and LOG fault on zero) and EXPT, C's correctly rounded `pow`. */
import type { IrMathName } from "../ir/index.js"
import { IecFault } from "./faults.js"

/**
 * The one-argument math functions. LOG is base 10 in IEC.
 *
 * A LOGARITHM OF ZERO STOPS THE TASK, and nothing else in this table stops anything. Measured across all ten
 * functions' domain edges (`operators/math-domain.ts`, 2026-09-18) — the whole rest of the table completes:
 *
 *   SQRT(-1) ASIN(2) ACOS(-2) LN(-1) LOG(-1) SIN(inf)   ->  NaN
 *   EXP(1000) SQRT(inf) LN(inf)                         ->  Infinity
 *   EXP(-1000)                                          ->  0
 *   TAN(pi/2)                                           ->  1.6331239353195370E16, finite
 *   LN(0) LOG(0)                                        ->  THE SCAN NEVER COMPLETES
 *
 * Which makes exactly two things stop a CODESYS task: dividing by zero (`arith`) and this. Both are the machine's
 * divide-by-zero, and neither is "the result was infinite" — `EXP(1000)` is infinite and runs.
 */
const logarithm =
  (f: (x: number) => number) =>
  (x: number): number => {
    if (x === 0) throw new IecFault("logarithm-of-zero")
    return f(x)
  }

/**
 * CODESYS'S TRIG IS THE x87 FPU, AND THAT IS WHY THREE FIXTURES DIVERGE. Identified 2026-09-19 by computing the
 * same arguments to 300 bits:
 *
 *   COS(1.5708)    exact -3.6732051033465738e-6   here -3.673205103346574e-6   CODESYS -3.6732051033465756e-6
 *   COS(1.0E18)    exact  0.11837199021871073     here  the same               CODESYS  0.11965025504785125
 *
 * So near a zero of COS the CORRECTLY ROUNDED answer is this one and CODESYS is a few ULPs out — the hardware
 * kernel's own error. And for a huge angle CODESYS reduces the argument with FSIN's 66-BIT approximation of pi
 * rather than an exact one: reducing 1.0E18 by `round(pi * 2^64) / 2^64` reproduces its COS to all seventeen
 * digits and its SIN to sixteen.
 *
 * NOT emulated, and the reason is that only HALF of it can be. The reduction is reproducible — u128 arithmetic
 * would do it in the emitted Rust as BigInt would here — but the kernel that runs after it is a hardware
 * polynomial, and matching `COS(1.5708)` needs that, not the reduction (1.5708 is below pi, so nothing is
 * reduced). Doing the half that is possible would close `mathdom_sin_large` and `mathdom_cos_large` and leave
 * `op_math_trig` exactly as it is, while making every other program's trig depend on emulated hardware. The
 * three stay recorded as divergences, now with a cause rather than a shrug.
 */
export const MATH: Readonly<Record<IrMathName, (x: number) => number>> = {
  sqrt: Math.sqrt,
  ln: logarithm(Math.log),
  log: logarithm(Math.log10),
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
}

/**
 * EXPT IS C'S `pow`, CORRECTLY ROUNDED — what CODESYS answers and what the emitted Rust's `powf` computes
 * (transpile-review-2026-09-29 task 46, `tr_46_exptdom_*`). `Math.pow` is not that, twice over:
 *
 *   EXPT(1, NaN)  EXPT(-1, ±inf)   ->  1 in C and CODESYS; NaN in JavaScript (the spec says so)
 *   EXPT(1E19, 8)                  ->  1E+152 exactly in CODESYS; 9.999999999999998E151 in JavaScriptCore
 *
 * The second is JavaScriptCore's INTEGER-exponent path: repeated multiplication, rounded at every step, a few ULPs
 * out. A fractional exponent goes to the C library's `pow`, the very function `powf` calls — measured identical on
 * 5000 random pairs — so only an integer exponent is computed here, exactly (`integerPower`). Measured against Rust
 * on 15000 random integer-exponent pairs: identical except 3, where Windows' UCRT `pow` is one ULP out and this is
 * the correctly rounded one (checked exactly, 2026-09-29).
 *
 * A ZERO TO A FINITE NEGATIVE POWER STOPS THE TASK: EXPT(0, -1) and EXPT(0, -0.5) never complete — the machine's
 * divide by zero, as `/` and LN(0) are. EXPT(0, -inf) is +inf and runs.
 */
export function expt(x: number, y: number): number {
  if (x === 0 && y < 0 && y !== -Infinity) throw new IecFault("zero-to-negative-power")
  if (x === 1 || y === 0) return 1
  if (x === -1 && (y === Infinity || y === -Infinity)) return 1
  if (Number.isInteger(y) && Number.isFinite(x) && x !== 0) return integerPower(x, y)
  return Math.pow(x, y)
}

/**
 * x^n for a finite non-zero x and an integer n, correctly rounded to nearest-even. |x| is m·2^e with an integer m, so
 * x^n is bracketed by BigInt powers truncated to `p` bits — one rounded down, one rounded up — and when both round to
 * the same double that double is the answer; otherwise `p` doubles (Ziv's loop). An exact power never truncates once
 * `p` covers its bits, so a result that lands exactly on a tie terminates too.
 */
function integerPower(x: number, y: number): number {
  const negative = x < 0 && y % 2 !== 0
  const { m, e } = significand(x)
  const n = BigInt(Math.abs(y))
  for (let p = 64; ; p *= 2) {
    const lo = power(m, e, n, p, false)
    const hi = power(m, e, n, p, true)
    const a = y > 0 ? toDouble(lo) : toDouble(reciprocal(hi, p, false))
    const b = y > 0 ? toDouble(hi) : toDouble(reciprocal(lo, p, true))
    if (a === b) return negative ? -a : a
  }
}

/** |x| as m·2^e with an integer m, read from its bits. */
function significand(x: number): Scaled {
  const bits = new DataView(new Float64Array([x]).buffer).getBigUint64(0, true)
  const biased = Number((bits >> 52n) & 0x7ffn)
  const fraction = bits & ((1n << 52n) - 1n)
  return biased === 0 ? { m: fraction, e: -1074 } : { m: fraction | (1n << 52n), e: biased - 1075 }
}

/** A positive value m·2^e; a `huge` exponent stands for "past every double" in its direction. */
type Scaled = { m: bigint; e: number }

const bitLength = (m: bigint): number => m.toString(2).length

/** m·2^e cut to p bits, rounded down or up. */
function cut({ m, e }: Scaled, p: number, up: boolean): Scaled {
  const shift = bitLength(m) - p
  if (shift <= 0) return { m, e }
  const kept = m >> BigInt(shift)
  return { m: up && kept << BigInt(shift) !== m ? kept + 1n : kept, e: e + shift }
}

/** (m·2^e)^n bracketed from below (`up` false) or above, by square-and-multiply at p bits. Stops early once a partial
 *  power is past every double: a partial power lies between 1 and the whole one, so the whole one is past it too. */
function power(m: bigint, e: number, n: bigint, p: number, up: boolean): Scaled {
  let result: Scaled = { m: 1n, e: 0 }
  let base: Scaled = { m, e }
  for (let k = n; k > 0n; k >>= 1n) {
    if (k & 1n) result = cut({ m: result.m * base.m, e: result.e + base.e }, p, up)
    const top = bitLength(base.m) + base.e
    if (top > 1200 || top < -1200) return { m: 1n, e: top > 0 ? 1e6 : -1e6 }
    if (k > 1n) base = cut({ m: base.m * base.m, e: base.e * 2 }, p, up)
  }
  return result
}

/** 1/(m·2^e) to p bits, rounded down or up. */
function reciprocal({ m, e }: Scaled, p: number, up: boolean): Scaled {
  const q = p + bitLength(m)
  const one = 1n << BigInt(q)
  const quotient = one / m
  return { m: up && quotient * m !== one ? quotient + 1n : quotient, e: -e - q }
}

/** m·2^e rounded to the nearest double, ties to even — subnormals and overflow included. */
function toDouble({ m, e }: Scaled): number {
  const top = bitLength(m) - 1 + e // the exponent of m's leading bit
  if (top > 1023) return Infinity
  const precision = Math.min(53, top + 1075) // the bits a double has from that leading bit down to 2^-1074
  if (precision < 0) return 0
  const shift = bitLength(m) - precision
  let kept = m
  let scale = e
  if (shift > 0) {
    kept = m >> BigInt(shift)
    const rest = m - (kept << BigInt(shift))
    const half = 1n << BigInt(shift - 1)
    if (rest > half || (rest === half && (kept & 1n) === 1n)) kept += 1n
    scale += shift
  }
  // two steps, so an intermediate power of two never underflows (kept < 2^54, scale ≥ -1074 - 53)
  const step = Math.max(-1000, Math.min(1000, scale))
  return Number(kept) * 2 ** step * 2 ** (scale - step)
}
