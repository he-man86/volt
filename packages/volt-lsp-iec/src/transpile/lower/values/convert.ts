/**
 * Conversions as IR nodes, and how a constant is stored at a type — the one place a value changes type.
 */

import type { IrExpr, IrStmt, IrValue, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { LoweringBug } from "../../semantics/faults.js"
import {
  commonType,
  elementaryRef,
  elemOf,
  integerLiteralType,
  isBoolValued,
  isReal,
  storeInteger,
  type Type,
} from "../../../frontend/types/index.js"
import { integerFoldType } from "./fold.js"

/** Wrap in an explicit conversion when the types differ — a backend never widens on its own. Two STRINGs of different
 *  capacity differ too: the conversion is where a longer string is truncated into a shorter one. */
export function convert(e: IrExpr, to: Type): IrExpr {
  const from = elemOf(e.type)
  const target = elemOf(to)
  // A BIT holds a BOOLEAN (`isBoolValued`, design §9) — it is one bit only in the LAYOUT. So a BIT and a BOOL are the
  // same value and neither `BOOL_TO_BIT` nor a plain store between them converts anything; typed as the 1-bit bit string
  // it is declared as, every crossing printed `!= 0` against a Rust `bool` (conformance `ct_bit_fields`).
  if (isBoolValued(e.type) && isBoolValued(to)) return e
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

/**
 * THE ONE IR ASSIGNMENT — a value stored into a place that already holds one (model 2, design §3.2 step 3c). It converts
 * as {@link convert} does, but for a STRING into a STRING (a WSTRING into a WSTRING) of another capacity, which it hands
 * over UNCONVERTED: a string store reads the SOURCE's capacity — it writes `min(n, m)` units of the source's buffer and
 * keeps the destination's units behind them (`storeString`; `string_assign_tail_wide`, `string_literal_nul_tail`), so `n`
 * has to survive to the store, and a conversion to the target's type would make it `m`. A literal keeps its own unit count
 * the same way. Both backends store through the value's type: the interpreter's `compileWrite`, the emitter's
 * `place.store(&v)`. A sizeless string reaching here is a lowering bug: every string Type carries its capacity
 * (`Lowering.resolve`).
 */
export function assignTo(target: Place, value: IrExpr, span: Span): IrStmt {
  if (!sameWidthStrings(value.type, target.type)) return { kind: "assign", target, value: convert(value, target.type), span }
  if (stringCapacity(value.type) === undefined || stringCapacity(target.type) === undefined)
    throw new LoweringBug(`a string store with no capacity on one side (${typeText(value.type)} into ${typeText(target.type)})`)
  return { kind: "assign", target, value, span }
}

/** Two STRINGs or two WSTRINGs, whatever their capacities. */
function sameWidthStrings(a: Type, b: Type): boolean {
  return a.kind === "elementary" && b.kind === "elementary" && a.name === b.name && (a.name === "STRING" || a.name === "WSTRING")
}

const stringCapacity = (t: Type): number | undefined => (t.kind === "elementary" ? t.length : undefined)
const typeText = (t: Type): string => (t.kind === "elementary" ? `${t.name}${t.length === undefined ? "" : `(${t.length})`}` : t.kind)

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
function adopt(c: IrExpr, to: Type): IrExpr {
  return isReal(c.type) && !isReal(to) ? c : retype(c, to)
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
  if (isReal(to) && typeof v === "bigint") return Number(v)
  // A BIT holds a BOOLEAN, and it is `bitstring` in the type table only because it is one bit of LAYOUT. Without
  // `isBoolValued` here, `x : BIT := 0` stored `0n` and the emitted Rust printed an integer into a `bool` field
  // (`bound_bit_at_min` / `_at_max`, measured 2026-09-18 — CODESYS reads them back FALSE and TRUE).
  if (isBoolValued(to) && typeof v === "bigint") return v !== 0n
  if (!isReal(to) && typeof v === "number" && Number.isInteger(v)) return valueAs(BigInt(v), to)
  return v
}

/**
 * A constant as a variable of `to` HOLDS it — at the integer's width. Measured (conformance `overflow_*`, `cc_literal_*`):
 * `value : INT := 40000` holds -25536 and `si := 128` into a SINT -128. Only where a value is stored — an initial value,
 * or a constant converted into its target — never while an operand is still on its way to promotion (`valueAs`). The
 * width used to be left to the backends: the interpreter wrapped on store, the emitter printed `40000i16`, which rustc rejects.
 * The rule is the front-end's `storeInteger`, which the interpreter's `fit` stores through too (6.B.2): a BIT is no
 * integer there, so it is not wrapped (this said `rank === undefined` once, which made every TIME and DATE skip the wrap
 * `fit` made — two backends, one program, two answers).
 */
export function stored(v: IrValue, to: Type): IrValue {
  return typeof v === "bigint" ? storeInteger(v, to) : v
}
