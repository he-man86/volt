/**
 * INTEGER WIDTHS — the integer type of a width, and a value as a variable of a width holds it. One home: the ladder was
 * written six times, with `<=` in some copies and `===` in others, which agree on the four widths the table has and
 * would not on a fifth.
 */
import { elementaryType, type ElementaryType } from "./elementary.js"

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
