/**
 * INTEGER WIDTHS — the integer type of a width, and a value as a variable of a width holds it. One home: the ladder was
 * written six times, with `<=` in some copies and `===` in others, which agree on the four widths the table has and
 * would not on a fifth.
 */
import { elementaryType, type ElementaryType } from "./elementary.js"
import { holdsIntegerBits } from "./predicates.js"
import { elemOf, type Type } from "./type.js"

/**
 * THE INTEGER LADDER: the narrowest {signed, unsigned} type that holds `bits`.
 */
export function integerOfWidth(bits: number, signed: boolean): ElementaryType {
  const order = signed ? ["SINT", "INT", "DINT", "LINT"] : ["USINT", "UINT", "UDINT", "ULINT"]
  return elementaryType(bits <= 8 ? order[0]! : bits <= 16 ? order[1]! : bits <= 32 ? order[2]! : order[3]!)!
}

/** An integer as a variable of the integer or bit-string type `e` holds it — wrapped to its width, two's complement
 *  when it is signed. */
export function wrapToWidth(v: bigint, e: ElementaryType): bigint {
  return e.signed ? BigInt.asIntN(e.bits, v) : BigInt.asUintN(e.bits, v)
}

/**
 * THE ONE INTEGER STORE RULE (transpile-restructure 6.B.2): an integer as a variable of `t` HOLDS it — wrapped at the
 * width of a type held as integer bits (`holdsIntegerBits`: an integer, a bit string, a duration, a date), unchanged in any
 * other (a BIT and a BOOL hold a BOOLEAN, a REAL a float, a STRING text: their stores are their own rules). Lowering's
 * `stored` and the interpreter's `fit` both store through it, so the two backends cannot wrap one value two ways.
 */
export function storeInteger(v: bigint, t: Type): bigint {
  return holdsIntegerBits(t) ? wrapToWidth(v, elemOf(t)!) : v
}

/** An elementary type's width in bits — what a shift or a rotate on it counts in — or undefined for any other type. */
export function widthOf(t: Type): number | undefined {
  return t.kind === "elementary" ? t.elem.bits : undefined
}
