/** HOW A TYPE STORES A VALUE (`fit`): the integer wrap at the declared width, REAL as a 32-bit float, BIT and BOOL as a BOOLEAN, a
 *  STRING cut at its capacity. */
import { holdsIntegerBits, isBoolValued, storeInteger, type Type } from "../../frontend/types/index.js"
import type { Val } from "./value.js"
import { held } from "./string.js"
import { defaultNaN, NaNBits } from "./nan.js"
import { LoweringBug } from "./faults.js"

/**
 * A value as its type STORES it — the interpreter's counterpart of the emitter's `wrapping_*` and `f32`. IEC
 * integers wrap at their declared width and REAL is a 32-bit float (both measured against CODESYS, `conformance`);
 * JavaScript gives neither for free, a bigint being unbounded and a number being float64. Every node that
 * produces a typed value passes through here, so an operand is always already in its type's representation.
 */
export function fit(v: Val, type: Type): Val {
  if (type.kind !== "elementary") return v
  const { family, bits, signed } = type.elem
  if (family === "real") {
    // AN INFINITY IS AN ORDINARY VALUE. This used to throw here, on the reading that an infinity stops the task and
    // a NaN does not — which fitted the four domain measurements and was still WRONG, because both of the cases that
    // stopped were divisions by zero:
    //
    //   SQRT(-1) -> REAL#NaN, completes    LN(-1) -> REAL#NaN, completes
    //   LN(0)    -> stops                  1.0/0  -> stops
    //
    // `operators/real-overflow.ts` separated the two readings and the answer is not the value (2026-09-18):
    //
    //   big * big        -> REAL#Infinity, completes        3.0E38 squared
    //   big + big        -> REAL#Infinity, completes
    //   1.0E38 / 1.0E-38 -> REAL#Infinity, completes        a DIVISION that overflows, divisor NOT zero
    //   num / (num-num)  -> stops                           divisor IS zero
    //   inf * 0.0        -> REAL#NaN,      completes        and the infinity is readable a statement later
    //
    // So a REAL variable can hold `REAL#Infinity` — `bound_real_above_max` holds one from a mere declaration — and
    // what stops the task is DIVIDING BY ZERO, exactly as it is for integers. That rule lives in `arith`.
    //
    // A NaN IS ITS BITS (`semantics/nan.ts`), never a JavaScript NaN, which has no sign or payload: one an operation made
    // from operands that are none — the only kind that reaches here, every operation over a NaN answering its operand
    // (`realResult`) — is x86's default NaN, sign set (SQRT(-1) recorded 16#FFC00000). One of the other width is a
    // conversion lowering did not make.
    if (v instanceof NaNBits) {
      if (v.width !== bits) throw new LoweringBug(`a ${v.width}-bit NaN stored as a ${type.elem.name}`)
      return v
    }
    if (typeof v === "number" && Number.isNaN(v)) return defaultNaN(bits === 32 ? 32 : 64)
    return bits === 32 && typeof v === "number" ? Math.fround(v) : v
  }
  // A BIT HOLDS A BOOLEAN. It is `bitstring` in the type table because it is one bit of LAYOUT, and everything else
  // already knew better — `typeZero` starts it `false` and the emitter maps it to Rust `bool` — but an
  // explicit initializer took the integer path below and stored `0n`, so `x : BIT := 0` read back as 0 where CODESYS
  // says FALSE (`bound_bit_at_min` / `_at_max`, 2026-09-18; and `:= -1` or `:= 2` is refused outright, "Cannot
  // convert type 'SINT' to type 'BIT'"). The default value was right only because nothing converted it. A BOOL holds the
  // same value (`isBoolValued`), an integer into it "not zero" as lowering's `valueAs` makes it.
  if (isBoolValued(type)) return typeof v === "bigint" ? v !== 0n : v
  // a STRING(n) keeps its first n characters — `STRING(5) := 'abcdefgh'` is 'abcde' (conformance `string_*`)
  // the buffer cut at the target's capacity — as the prelude's `to` copies the units both buffers hold. This is a FRESH
  // buffer (a call's input, a binding); an assignment into a buffer already there is `storeString` (`interp/frame.ts`)
  if (family === "string") return typeof v === "string" && type.length !== undefined ? held(v.slice(0, type.length)) : v
  // an integer is stored as `storeInteger` says, the rule lowering's `stored` reads too (6.B.2): a duration or date wraps
  // like the integer it is — TIME and TOD are 32-bit milliseconds, DATE and DT 32-bit seconds, the L variants 64-bit
  // nanoseconds (design §16, §17). `inWidth` only spares the wrap's allocation where the value already fits.
  if (typeof v !== "bigint") return v
  return holdsIntegerBits(type) && inWidth(v, bits, signed) ? v : storeInteger(v, type)
}

/** Whether an integer already lies inside `bits` of the given signedness — two comparisons against bounds computed
 *  once per width, where the `asIntN` that answers the same allocates a new bigint every time it runs. */
const lowest: bigint[] = []
const highest: bigint[] = []
function inWidth(v: bigint, bits: number, signed: boolean): boolean {
  const at = bits * 2 + (signed ? 1 : 0)
  if (lowest[at] === undefined) {
    lowest[at] = signed ? -(1n << BigInt(bits - 1)) : 0n
    highest[at] = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n
  }
  return v >= lowest[at]! && v <= highest[at]!
}
