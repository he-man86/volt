/** THE OPERATORS ON VALUES: comparison, arithmetic (with the two faults a division has) and AND/OR/XOR. */
import { elemOf, type Type } from "../../frontend/types/index.js"
import { IecFault } from "./faults.js"
import { bool, num, type Val } from "./value.js"
import { visible } from "./string.js"

// Lowering converts both operands of a comparison to ONE type, so the two values always share a representation, and
// JavaScript's own operators compare it exactly — bigints as bigints (a LINT above 2^53 included), strings by code unit.
// a string compares as the string it holds, not its buffer: the bytes behind the terminator are not part of it
const compared = (v: Val): Val => (typeof v === "string" ? visible(v) : v)

export function eq(a: Val, b: Val): boolean {
  return compared(a) === compared(b)
}

export function ord(op: "lt" | "le" | "gt" | "ge", a: Val, b: Val): boolean {
  const l = compared(a)
  const r = compared(b)
  return op === "lt" ? l < r : op === "le" ? l <= r : op === "gt" ? l > r : l >= r
}

export function arith(op: string, a: Val, b: Val, type?: Type): Val {
  const l = num(a)
  const r = num(b)
  if (typeof l === "bigint" && typeof r === "bigint") {
    // `/` by zero stops the application (the recorder's read times out); MOD by zero is 0 in every width and signedness,
    // the dividend's sign regardless (conformance `mod_by_zero`, `cc_mod_udint_dint`)
    if (op === "div" && r === 0n) throw new IecFault("division-by-zero")
    if (op === "mod" && r === 0n) return 0n
    // A DIVISION WHOSE RESULT DOES NOT FIT THE COMPUTATION WIDTH STOPS THE TASK — `MIN / -1`, and nothing else can
    // reach it. This is the CPU's divide-overflow trap, not a wrap, and the measurements say exactly that
    // (`arithedge_*_div_min_by_minus_one`, 2026-09-18):
    //
    //   SINT  -128 / -1                 ->  SINT#-128       an 8-bit operand computes in DINT, where 128 fits,
    //   INT   -32768 / -1               ->  INT#-32768      so the division succeeds and only the STORE wraps
    //   DINT  -2147483648 / -1          ->  STOPS           computed in DINT: 2147483648 does not fit
    //   LINT  -9223372036854775808 / -1 ->  STOPS           computed in LINT: same
    //
    // So the width that matters is the one the operation COMPUTES in — `e.type`, the promoted type — and not the
    // slot's. Every other overflow in this function wraps on store and none of them trap.
    const elem = type !== undefined ? elemOf(type) : undefined
    if (op === "div" && elem?.signed === true && elem.bits !== undefined) {
      const quotient = l / r
      if (BigInt.asIntN(elem.bits, quotient) !== quotient)
        throw new IecFault("division-overflow")
    }
    switch (op) {
      case "add":
        return l + r
      case "sub":
        return l - r
      case "mul":
        return l * r
      case "div":
        return l / r // truncating, as IEC integer division is
      case "mod":
        return l % r
    }
  }
  const x = Number(l)
  const y = Number(r)
  // A REAL DIVISION BY ZERO STOPS THE TASK TOO — IEEE would answer an infinity and carry on, and the vendor does
  // not: `realovf_divide_by_computed_zero` never finishes its scan while `realovf_divide_small_by_smaller`, which
  // overflows to the same infinity without a zero divisor, finishes fine. The divisor is what matters, not the
  // result. `-0.0 === 0` in JS, so a negative zero divisor is caught by the same test.
  if (op === "div" && y === 0) throw new IecFault("division-by-zero")
  switch (op) {
    case "add":
      return x + y
    case "sub":
      return x - y
    case "mul":
      return x * y
    case "div":
      return x / y
    case "mod":
      return x % y
  }
  throw new TypeError(`unknown arithmetic op ${op}`)
}

/** AND/OR/XOR — boolean on BOOLs, bitwise on ints. Both are legal IEC; the operand type decides. */
export function logic(op: "and" | "or" | "xor", a: Val, b: Val): Val {
  if (typeof a === "bigint" && typeof b === "bigint") return op === "and" ? a & b : op === "or" ? a | b : a ^ b
  const l = bool(a)
  const r = bool(b)
  return op === "and" ? l && r : op === "or" ? l || r : l !== r
}

/**
 * AND_THEN / OR_ELSE over two operands evaluated on demand — the right one only when the left does not decide. The
 * only reason these are distinct nodes is that the right side must not run otherwise; a caller passes its operands as
 * functions of its own context (`a`), so the interpreter evaluates them on its frame and the fold on nothing.
 */
export function shortCircuit<A>(op: "and_then" | "or_else", left: (a: A) => Val, right: (a: A) => Val): (a: A) => boolean {
  return op === "and_then" ? (a) => bool(left(a)) && bool(right(a)) : (a) => bool(left(a)) || bool(right(a))
}
