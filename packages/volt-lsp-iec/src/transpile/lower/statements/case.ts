/**
 * CASE: a switch over constant label ranges, each a value of the selector's type.
 */

import type { Lowering } from "../core/lowering.js"
import type { Statement } from "../../../frontend/syntax/index.js"
import type { IrArm, IrStmt, IrValue } from "../../ir/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { anySize } from "../pointers/any.js"
import { elemOf } from "../../../frontend/types/index.js"
import { foldConstant } from "../values/fold.js"
import { lowerBlock } from "./statements.js"

/** CASE: a switch over constant label ranges, each a value of the selector's type. */
export function lowerCase(lw: Lowering, s: Extract<Statement, { kind: "case" }>): IrStmt | IrStmt[] | undefined {
  const selector = lowerExpr(lw, s.selector)
  if (selector === undefined) return undefined
  // `CASE anyArg.diSize OF` in a variant whose argument is a variable: the size is that variable's, so the arms for
  // other sizes never run — and they dereference `pValue` as a type it is not, which is refused (transpile-review 17).
  // They are not lowered, so pro2193's `Increment.AnyInt` still lowers per size (`state_any_int_pointer_increment`).
  const size = anySize(lw, s.selector)
  const reaches = (labels: readonly { lo: IrValue; hi: IrValue }[]) => size === undefined || labels.some((l) => (l.lo as bigint) <= size && size <= (l.hi as bigint))
  // A label is a value OF the selector's type: one outside it is "Cannot convert type 'INT' to type 'SINT'" (300 or
  // -212 on a SINT — it does not wrap in), and a range inverted once its bounds are read in that type (5..1, or 0..200
  // on a SINT) is "Lower border must be lower than upper border" (`tr_37_case_*`). Both reached the emitter verbatim.
  const sel = elemOf(selector.type)
  const range = sel?.family === "int" || sel?.family === "bitstring" ? sel.range : undefined
  const labelInType = (lo: IrValue, hi: IrValue): boolean => {
    if (typeof lo !== "bigint" || typeof hi !== "bigint") return true
    if (range !== undefined && (lo < range.min || lo > range.max || hi < range.min || hi > range.max)) return false
    return lo <= hi
  }
  const arms: IrArm[] = []
  let matched = false
  for (const arm of s.arms) {
    const labels: { lo: IrValue; hi: IrValue }[] = []
    for (const label of arm.labels) {
      const lo = foldConstant(lw, label.value)
      const hi = label.upper === undefined ? lo : foldConstant(lw, label.upper)
      if (lo === undefined || hi === undefined) {
        lw.bail("case-label", "a CASE label that is not a compile-time constant", label.span)
        return undefined
      }
      if (!labelInType(lo, hi)) {
        lw.bail("case-label-type", "a CASE label outside the selector's type, or an inverted range", label.span)
        return undefined
      }
      labels.push({ lo, hi })
    }
    if (!reaches(labels)) continue
    matched ||= size !== undefined
    arms.push({ labels, body: lowerBlock(lw, arm.body), span: arm.span })
  }
  const otherwise = s.elseBody && !matched ? lowerBlock(lw, s.elseBody) : []
  // the variant's own size picks ONE arm, or none: that body is the statement (lean 7.7.9) — no match on a constant
  if (size !== undefined) return arms.length === 0 ? otherwise : [...arms[0]!.body]
  return { kind: "switch", selector, arms, else: otherwise, span: s.span }
}
