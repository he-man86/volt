/**
 * A REAL OR LREAL NaN, HELD AS ITS BITS (transpile-restructure 8.2, design.md §7.2 Decision step 8c). JavaScriptCore
 * canonicalizes every NaN a `number` holds — 16#7FA00000, 16#FFC00000 and 16#7FC00001 all read back 16#7FC00000 — so a
 * NaN cannot stay a number and keep the sign and payload CODESYS keeps. A NaN value is a `NaNBits`; every other REAL value
 * stays a `number`, and no REAL `Val` is ever a JavaScript NaN (`fit` turns one into the default NaN below).
 *
 * WHAT CODESYS DOES WITH ONE, recorded as bits (`nan_payload_ops`, `nan_payload_ops_lreal`, `nan_payload_select_trig`,
 * record:exec 2026-10-11) — x86's SSE rules, the operand order the source's:
 *   - an operation with a NaN operand answers its FIRST NaN operand, QUIETED (its quiet bit set, sign and payload kept):
 *     sNaN + 1 and 1 + sNaN are 16#7FE00000, pay + sNaN is pay, sNaN + pay the sNaN quieted; the same for - * /, EXPT,
 *     SQRT, LN, LOG, EXP and the trigonometric functions, and NEG — whose NaN keeps its SIGN (-16#7FC12345 is 16#7FC12345);
 *   - ABS quiets it and clears its sign (ABS(16#FF812345) is 16#7FC12345);
 *   - a NaN an operation makes from operands that are none — SQRT(-1), LN(-1), ASIN(2), inf - inf, inf * 0 — is x86's
 *     default NaN, sign SET: 16#FFC00000, 16#FFF8000000000000;
 *   - REAL ↔ LREAL quiets it and moves its payload: the 23 bits are the top of the 52 (16#7FC12345 is 16#7FF82468A0000000;
 *     16#7FF8123400000000 is 16#7FC091A0, the low 29 bits cut);
 *   - a copy, a load, a store and the selects (MAX, MIN, LIMIT, SEL, MUX) carry it as it is — a signalling one stays
 *     signalling; it compares unequal to everything, itself included; EXPT(NaN, 0) is 1, as C's `pow` says.
 */
import { LoweringBug } from "./faults.js"

export class NaNBits {
  constructor(
    /** The NaN's bits — all the exponent's set and a payload that is not 0. */
    readonly bits: bigint,
    readonly width: 32 | 64,
  ) {
    if (!isNaNPattern(bits, width)) throw new LoweringBug(`${bits.toString(16)} is no ${width}-bit NaN`)
  }
}

/** The layout of each width: its sign bit, its exponent's bits, its quiet bit, and how far LREAL's payload sits above REAL's. */
const SIGN = { 32: 1n << 31n, 64: 1n << 63n } as const
const EXPONENT = { 32: 0xffn << 23n, 64: 0x7ffn << 52n } as const
const MANTISSA = { 32: (1n << 23n) - 1n, 64: (1n << 52n) - 1n } as const
const QUIET = { 32: 1n << 22n, 64: 1n << 51n } as const
const PAYLOAD_SHIFT = 29n

function isNaNPattern(bits: bigint, width: 32 | 64): boolean {
  return (bits & EXPONENT[width]) === EXPONENT[width] && (bits & MANTISSA[width]) !== 0n && bits >> BigInt(width) === 0n
}

/** x86's default NaN: quiet, no payload, its SIGN set (SQRT(-1) recorded `wn` 16#FFC00000, `tr_28_*`). */
export function defaultNaN(width: 32 | 64): NaNBits {
  return new NaNBits(SIGN[width] | EXPONENT[width] | QUIET[width], width)
}

/** The NaN with its quiet bit set — what an operation answers for its NaN operand. */
export const quieted = (n: NaNBits): NaNBits => new NaNBits(n.bits | QUIET[n.width], n.width)

/** ABS of a NaN: quieted, its sign cleared. */
export const absNaN = (n: NaNBits): NaNBits => new NaNBits((n.bits | QUIET[n.width]) & ~SIGN[n.width], n.width)

/** A NaN at the other width, as REAL_TO_LREAL / LREAL_TO_REAL convert it: quieted, the payload's top bits kept in place. */
export function atWidth(n: NaNBits, width: 32 | 64): NaNBits {
  if (n.width === width) return n
  const sign = (n.bits & SIGN[n.width]) === 0n ? 0n : SIGN[width]
  const mantissa = n.width === 32 ? (n.bits & MANTISSA[32]) << PAYLOAD_SHIFT : (n.bits & MANTISSA[64]) >> PAYLOAD_SHIFT
  return new NaNBits(sign | EXPONENT[width] | mantissa | QUIET[width], width)
}

/** The NaN an operation over `operands` answers when its result is one: the first NaN operand, quieted, at `width` — or,
 *  where no operand is a NaN, the default one. */
function nanOf(operands: readonly unknown[], width: 32 | 64): NaNBits {
  const first = operands.find((o): o is NaNBits => o instanceof NaNBits)
  return first === undefined ? defaultNaN(width) : atWidth(quieted(first), width)
}

/** A REAL operation's answer: `result`, or — where it is a NaN — `nanOf` its operands. */
export function realResult(result: number, operands: readonly unknown[], width: 32 | 64 | undefined): number | NaNBits {
  if (!Number.isNaN(result)) return result
  if (width === undefined) throw new LoweringBug("a NaN answered by an operation lowering did not type REAL or LREAL")
  return nanOf(operands, width)
}

/** The eight bytes a REAL's bits are read and written through — one, reused: a load or store of a REAL is a hot path. */
const SCRATCH = new DataView(new ArrayBuffer(8))

/** A REAL value's bits: a NaN's own, any other number's IEEE encoding at `width`. */
export function floatBitsOf(v: number | NaNBits, width: 32 | 64): bigint {
  if (v instanceof NaNBits) {
    if (v.width !== width) throw new LoweringBug(`a ${v.width}-bit NaN stored as a ${width}-bit REAL`)
    return v.bits
  }
  // a REAL value is never the JavaScript NaN (`fit` makes it `NaNBits`): one here bypassed the store
  if (Number.isNaN(v)) throw new LoweringBug("a REAL NaN that is no NaNBits — a value that bypassed `fit`")
  if (width === 32) {
    SCRATCH.setFloat32(0, v)
    return BigInt(SCRATCH.getUint32(0))
  }
  SCRATCH.setFloat64(0, v)
  return SCRATCH.getBigUint64(0)
}

/** The REAL value `bits` encode at `width`: a NaN as its bits, anything else as the number. */
export function floatFromBits(bits: bigint, width: 32 | 64): number | NaNBits {
  if (isNaNPattern(bits, width)) return new NaNBits(bits, width)
  if (width === 32) {
    SCRATCH.setUint32(0, Number(bits))
    return SCRATCH.getFloat32(0)
  }
  SCRATCH.setBigUint64(0, bits)
  return SCRATCH.getFloat64(0)
}
