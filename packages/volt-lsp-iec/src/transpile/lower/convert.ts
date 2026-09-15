/**
 * Conversions as IR nodes, and how a constant is stored at a type — the one place a value changes type.
 */
import type { Span } from "../../syntax/index.js"
import { elemOf, type Type } from "../../types/index.js"
import type { IrBinOp, IrExpr, IrValue } from "../ir/index.js"

/** Wrap in an explicit conversion when the types differ — a backend never widens on its own. Two STRINGs of different
 *  capacity differ too: the conversion is where a longer string is truncated into a shorter one. */
export function convert(e: IrExpr, to: Type): IrExpr {
  const from = elemOf(e.type)
  const target = elemOf(to)
  // A constant lands at the target's width even when context already typed it so: `si := 128` types the literal SINT
  // on the way in, and this returned it unchanged below — the emitter printed `128i8`, which rustc rejects.
  if (e.kind === "const" && target !== undefined && from?.name === target.name && typeof e.value === "bigint")
    return { ...e, value: stored(e.value, to) }
  const sameCapacity =
    e.type.kind !== "elementary" || to.kind !== "elementary" || e.type.length === to.length
  if (from === undefined || target === undefined || (from.name === target.name && sameCapacity)) return e
  // Retyping a constant is free and leaves cleaner output than converting it at run time — at the target's width.
  if (e.kind === "const") {
    const retyped = retype(e, to)
    return retyped.kind === "const" ? { ...retyped, value: stored(retyped.value, to) } : retyped
  }
  return { kind: "convert", value: e, type: to, span: e.span }
}

/** Re-stamp a constant with a type, moving its value across the int/real divide if that is what changed. */
export function retype(e: IrExpr, to: Type): IrExpr {
  if (e.kind !== "const" || elemOf(to) === undefined) return e
  return { ...e, value: valueAs(e.value, to), type: to }
}

/**
 * A constant taking its variable neighbour's type — but never a REAL constant demoted to an integer. `int7 / 2.0`
 * is 3.5 in CODESYS (conformance `division_with_a_real_operand`); retyping the `2.0` to INT made it the integer 2
 * and the division integral. A REAL constant keeps its type, and `wider` meets the pair in REAL.
 */
export function adopt(c: IrExpr, to: Type): IrExpr {
  return elemOf(c.type)?.family === "real" && elemOf(to)?.family !== "real" ? c : retype(c, to)
}

/**
 * A constant value moved across the int/real divide to match `to`, and an integer into a BOOL as "not zero" — `b : BOOL
 * := 1` is TRUE and `:= 0` FALSE (conformance `cc_init_*_into_bool`, `cc_assign_one_into_bool`); both backends kept `1`.
 * NOT the width: a literal is also retyped on its way to promotion (`minus1 AND 255` types the 255 as SINT first), and
 * wrapping it there made it -1. The width is `stored`'s, where a value lands.
 */
export function valueAs(v: IrValue, to: Type): IrValue {
  const target = elemOf(to)
  if (target === undefined) return v
  if (target.family === "real" && typeof v === "bigint") return Number(v)
  if (target.family === "bool" && typeof v === "bigint") return v !== 0n
  if (target.family !== "real" && typeof v === "number" && Number.isInteger(v)) return valueAs(BigInt(v), to)
  return v
}

/**
 * A constant as a variable of `to` HOLDS it — at the integer's width. Measured (conformance `overflow_*`, `cc_literal_*`):
 * `value : INT := 40000` holds -25536 and `si := 128` into a SINT -128. Only where a value is stored — an initial value,
 * or a constant converted into its target — never while an operand is still on its way to promotion (`valueAs`). The
 * width used to be left to the backends: the interpreter wrapped on store, the emitter printed `40000i16`, which rustc rejects.
 */
export function stored(v: IrValue, to: Type): IrValue {
  const target = elemOf(to)
  if (typeof v !== "bigint" || target === undefined || target.rank === undefined) return v
  if (!["int", "bitstring", "time", "date"].includes(target.family)) return v
  return target.signed ? BigInt.asIntN(target.bits, v) : BigInt.asUintN(target.bits, v)
}

/** An explicit conversion node, even between a pointer and an integer — `convert` returns the value unchanged when either
 *  side is not elementary, and the emitted Rust then assigned an `i64` expression to a `usize` pointer field. */
export function cast(e: IrExpr, to: Type): IrExpr {
  return { kind: "convert", value: e, type: to, span: e.span }
}

/** A binary node of a type the caller states — pointer arithmetic, where no operator typing applies. */
export function binaryOf(op: IrBinOp, left: IrExpr, right: IrExpr, type: Type, span: Span): IrExpr {
  return { kind: "binary", op, left, right, type, span }
}
