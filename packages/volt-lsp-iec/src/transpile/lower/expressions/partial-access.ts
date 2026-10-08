/**
 * Partial access: a bit, byte, word or double word of an unsigned integer (`x.%X3`, `.%B3`, `.%W1`, `.%D0`).
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { lowerExpr } from "./expressions.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { convert } from "../values/convert.js"

/**
 * `x.%X3` / `.%B3` / `.%W1` / `.%D0` — partial access, a bit, byte, word or double word of an unsigned integer counted
 * from the low end: DWORD 16#DEADBEEF has %W1 16#DEAD, %B3 16#DE and %X3 TRUE (conformance
 * `operand_partial_word_in_dword`, `operand_partial_bit_in_dword`, `operand_partial_dword_in_lword`). The slice is the
 * value shifted down and narrowed. A signed source and a store INTO a slice are still not measured. `null` when the
 * member is no partial access.
 */
export function partialAccess(lw: Lowering, e: Extract<Expr, { kind: "member" }>): IrExpr | undefined | null {
  const partial = /^%([XBWD])(\d+)$/i.exec(e.member.name)
  if (partial === null) return null
  const source = lowerExpr(lw, e.base)
  if (source === undefined) return undefined
  const elem = source.type.kind === "elementary" ? source.type.elem : undefined
  const width = ({ X: 1, B: 8, W: 16, D: 32 } as Record<string, number>)[partial[1]!.toUpperCase()]
  const at = Number(partial[2])
  const unsigned = elem !== undefined && (elem.family === "bitstring" || (elem.family === "int" && !elem.signed))
  if (width === undefined || !unsigned || (at + 1) * width > elem.bits)
    return lw.bail("partial-access", `${e.member.name} of a ${source.type.kind === "elementary" ? source.type.name : source.type.kind} is not measured`, e.span)
  const count: IrExpr = { kind: "const", value: BigInt(at * width), type: elementaryRef("INT"), span: e.span }
  const shifted: IrExpr = { kind: "builtin", name: "shr", args: [source, count], type: source.type, span: e.span }
  // A BIT is not a one-wide slice of the same shape — there is no 1-bit elementary type to narrow into, and
  // converting a DWORD to BOOL would ask "is it non-zero" about the WHOLE word. Mask the low bit and compare.
  if (width === 1) {
    const one: IrExpr = { kind: "const", value: 1n, type: source.type, span: e.span }
    const masked: IrExpr = { kind: "binary", op: "and", left: shifted, right: one, type: source.type, span: e.span }
    const zero: IrExpr = { kind: "const", value: 0n, type: source.type, span: e.span }
    return { kind: "binary", op: "ne", left: masked, right: zero, type: elementaryRef("BOOL"), span: e.span }
  }
  const slice = elementaryRef(({ 8: "BYTE", 16: "WORD", 32: "DWORD" } as Record<number, string>)[width]!)
  return convert(shifted, slice)
}
