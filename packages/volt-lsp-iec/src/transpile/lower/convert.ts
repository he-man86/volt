/**
 * Conversions as IR nodes, and how a constant is stored at a type — the one place a value changes type.
 */
import type { Span } from "../../frontend/syntax/index.js"
import { commonType, elementaryRef, elemOf, integerLiteralType, type Type } from "../../frontend/types/index.js"
import { isBit, type IrBinOp, type IrExpr, type IrValue } from "../ir/index.js"
import type { Lowering } from "./lowering.js"

/**
 * A STRING or WSTRING converted IMPLICITLY into anything but itself, or anything converted implicitly into one — which
 * CODESYS refuses; true when refused. Both string kinds are isolated: `n := '12'` is "Cannot convert type 'STRING(INT#2)'
 * to type 'INT'", `s[0] := 'X'` stores a STRING into a character, `intoWide := narrow` is "Cannot convert type 'STRING'
 * to type 'WSTRING'" (`string_wstring_mixing`) and `out := -r` into a STRING is "Cannot convert type 'REAL' to type
 * 'STRING'" (`uop_*`). This refused only the first two, so the rest lowered to a conversion no vendor makes (transpile-review
 * 38). Every implicit store asks it — an assignment, a chain link, an input argument; the explicit X_TO_Y stays legal.
 * A side that is not elementary (a struct, an FB) is not this question.
 */
export function refuseImplicitString(lw: Lowering, value: IrExpr, target: Type, span: Span): boolean {
  const from = elemOf(value.type)
  const to = elemOf(target)
  if (from === undefined || to === undefined || (from.family !== "string" && to.family !== "string") || from.name === to.name) return false
  lw.bail("assign-string", `a ${from.name} converted implicitly to a ${to.name}, which is not a conversion the vendor makes implicitly`, span)
  return true
}

/** Wrap in an explicit conversion when the types differ — a backend never widens on its own. Two STRINGs of different
 *  capacity differ too: the conversion is where a longer string is truncated into a shorter one. */
export function convert(e: IrExpr, to: Type): IrExpr {
  const from = elemOf(e.type)
  const target = elemOf(to)
  // A BIT holds a BOOLEAN (`isBit`, design §9) — it is one bit only in the LAYOUT. So a BIT and a BOOL are the same
  // value and neither `BOOL_TO_BIT` nor a plain store between them converts anything; typed as the 1-bit bit string it
  // is declared as, every crossing printed `!= 0` against a Rust `bool` (conformance `ct_bit_fields`).
  if (isBit(e.type) || isBit(to)) {
    const bool = (t: Type) => isBit(t) || elemOf(t)?.family === "bool"
    if (bool(e.type) && bool(to)) return e
  }
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

const LINT_MAX = (1n << 63n) - 1n

/**
 * The type an ALL-constant integer expression folds at: LINT — wide enough that `2000000000 + 2000000000` is 4000000000
 * (conformance `constant_arithmetic_width`) — unless an operand holds a value only ULINT can: `18446744073709551615 > 5`
 * is TRUE and `16#FFFFFFFFFFFFFFFF / 16` is 16#0FFFFFFFFFFFFFFF (`const_literal_wider_than_lint`, LIVE). Folding
 * those at LINT wrapped them negative.
 */
export function integerFoldType(operands: readonly IrExpr[]): Type {
  const needsUlint = operands.some((o) => o.kind === "const" && typeof o.value === "bigint" && o.value > LINT_MAX)
  return elementaryRef(needsUlint ? "ULINT" : "LINT")
}

/**
 * A constant taking its variable neighbour's type — but never a REAL constant demoted to an integer. `int7 / 2.0`
 * is 3.5 in CODESYS (conformance `division_with_a_real_operand`); retyping the `2.0` to INT made it the integer 2
 * and the division integral. A REAL constant keeps its type, and `wider` meets the pair in REAL.
 */
function adopt(c: IrExpr, to: Type): IrExpr {
  return elemOf(c.type)?.family === "real" && elemOf(to)?.family !== "real" ? c : retype(c, to)
}

/**
 * An integer constant beside a variable of (lifted) type `to`: it takes that type only when it FITS. One that does not
 * keeps its own literal type and MEETS the variable — widened to LINT (ULINT past it) when even the meet cannot hold it.
 * `x + -3000000000` with `x : DINT` is LINT -2999999995, a UDINT literal beside a DINT meets at LINT and
 * `MAX(ud, 5000000000)` is 5000000000 (conformance `tr_6_literal_beyond_dint_neighbour`, LIVE); adopting the
 * neighbour's type wrapped each of them. An assignment still wraps at its target (`cc_literal_3e9_into_dint`).
 */
export function beside(c: IrExpr, to: Type): IrExpr {
  const own = ownIntegerType(c, to)
  return own === undefined ? adopt(c, to) : retype(c, own)
}

/** The type an integer constant keeps beside `to` because it does not fit it — undefined when it fits. */
export function ownIntegerType(c: IrExpr, to: Type): Type | undefined {
  if (c.kind !== "const" || typeof c.value !== "bigint" || elemOf(c.type)?.range === undefined) return undefined
  const v = c.value
  const holds = (t: Type): boolean => {
    const r = elemOf(t)?.range
    return r !== undefined && v >= r.min && v <= r.max
  }
  if (elemOf(to)?.range === undefined || holds(to)) return undefined
  const literal = integerLiteralType(v)
  if (literal === undefined) return undefined
  const own = elementaryRef(literal.name)
  return holds(commonType(to, own)) ? own : integerFoldType([c])
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
  // A BIT holds a BOOLEAN, and it is `bitstring` in the type table only because it is one bit of LAYOUT. Without
  // `isBit` here, `x : BIT := 0` stored `0n` and the emitted Rust printed an integer into a `bool` field
  // (`bound_bit_at_min` / `_at_max`, measured 2026-09-18 — CODESYS reads them back FALSE and TRUE).
  if ((target.family === "bool" || isBit(to)) && typeof v === "bigint") return v !== 0n
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
  if (typeof v !== "bigint" || target === undefined) return v
  // `isBit`, NOT `rank === undefined`, which is what this used to say. Only BIT is an int/bit-string family with
  // no rank — but so is every TIME and DATE, so the rank guard returned first and made the `"time"`/`"date"`
  // entries one line below UNREACHABLE. The other copy of this rule (`fit`, `ir/values.ts`) has no such guard
  // and does wrap them, so an over-range TIME initializer wrapped in the interpreter and printed as an
  // out-of-range `u32` literal from the emitter — two backends, one program, two answers.
  if (isBit(to)) return v
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
