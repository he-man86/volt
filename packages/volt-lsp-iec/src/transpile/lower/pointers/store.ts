/**
 * Storing an address: a pointer assigned, a reference bound (`REF=`).
 */

import type { Lowering } from "../lowering.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import type { Expr, Span, Statement } from "../../../frontend/syntax/index.js"
import { cursorOf } from "./cursor.js"
import { elemOf } from "../../../frontend/types/index.js"
import { binaryOf, cast } from "../core/build.js"
import { pointerKey, recordTarget } from "./state.js"
import { addressOf, pointerValue } from "./address.js"
import { lowerPlace } from "../places/places.js"
import { lowerExpr } from "../expressions/expressions.js"

/** `p := <pointer value>` — its target recorded for every body that dereferences `p`. */
export function storePointer(lw: Lowering, target: Place, value: Expr, span: Span): IrStmt | undefined {
  // a STRING CURSOR moves along the string it walks and nowhere else: `p := p + n` / `p := p - n`, by bytes
  const cursor = cursorOf(lw, target)
  if (cursor !== undefined) {
    // a whole-string cursor stays where it was bound, which is what keeps its `p^` a whole string (`cursorString`)
    if (elemOf(cursor.unit)?.family === "string") return lw.bail("pointer-value", "a POINTER TO STRING cursor moved along its string", span)
    const stepped = value.kind === "binary" && (value.op === "+" || value.op === "-") ? value : undefined
    const same = stepped?.left.kind === "ident_expr" && lw.localSlots[target.slot]?.name.toUpperCase() === stepped.left.name.toUpperCase()
    if (stepped === undefined || !same) return lw.bail("pointer-value", "a string cursor given anything but itself stepped by bytes", span)
    const bytes = lowerExpr(lw, stepped.right)
    if (bytes === undefined) return undefined
    const current: IrExpr = { kind: "load", place: target, type: target.type, span }
    // the step in the POINTER's type, as an element pointer's is: `convert` leaves a literal its own type (a SINT's
    // `1i8` beside a `usize` pointer did not compile — lib_prim_string_cursor_offset)
    const step: IrExpr = bytes.kind === "const" && typeof bytes.value === "bigint" ? { ...bytes, type: target.type } : cast(bytes, target.type)
    return { kind: "assign", target, value: binaryOf(stepped.op === "+" ? "add" : "sub", current, step, target.type, span), span }
  }
  const key = pointerKey(lw, target)
  if (key === undefined) return lw.bail("pointer-place", "a pointer stored somewhere this does not track", span)
  const stored = pointerValue(lw, value, target.type)
  if (stored === undefined) return undefined
  let written = stored.value
  if (stored.target !== undefined) {
    const tag = recordTarget(lw, key, stored.target, span)
    if (tag === undefined) return undefined
    // THE VALUE IS THE TAG once the pointer has more than one target. With one it stays what `addressOf` gave —
    // 1 for a variable, the element index + ELEMENT_TAG_BIAS for an array — which is form 1's encoding and what `p = 0`,
    // `__ISVALIDREF` and `p[i]` are all built on. Those two encodings cannot share a variable, so a pointer that
    // names several ELEMENTS is refused rather than given a tag that its index arithmetic would then read.
    const targets = lw.shared.pointers.get(key) ?? []
    if (targets.length > 1) {
      if (targets.some((t) => t.element !== undefined || t.chars !== undefined))
        return lw.bail("pointer-targets", "a pointer that names several variables, one of them an array element — the value would be both a tag and an index", span)
      written = { kind: "const", value: tag, type: target.type, span }
    }
  }
  if (lw.conditional === 0) lw.boundPointers.add(key)
  return { kind: "assign", target, value: written, span }
}

/** `r REF= x` — the reference's one target, and its value set (conformance `type_reference_to_int`, `op_sys_isvalidref`). */
export function bindReference(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt | undefined {
  const target = lowerPlace(lw, s.target)
  if (target === undefined) return undefined
  const key = target.type.kind === "reference" ? pointerKey(lw, target) : undefined
  if (key === undefined) return lw.bail("assign-op", "REF= into something that is not a tracked reference", s.span)
  const address = addressOf(lw, s.value, target.type, s.span)
  if (address === undefined) return undefined
  const tag = recordTarget(lw, key, address.target, s.span)
  if (tag === undefined) return undefined
  // THE TAG, once the reference names more than one variable — `storePointer` says why the two encodings cannot
  // share a slot. A reference rebound after its declaration is the shape this exists for
  // (`refdecl_rebound_by_statement`: before 1, after 2).
  const targets = lw.shared.pointers.get(key) ?? []
  if (targets.length > 1 && targets.some((t) => t.element !== undefined || t.chars !== undefined))
    return lw.bail("pointer-targets", "a reference rebound across an array element and a variable — the value would be both a tag and an index", s.span)
  const value = targets.length > 1 ? ({ kind: "const", value: tag, type: target.type, span: s.span } as IrExpr) : address.value
  if (lw.conditional === 0) lw.boundPointers.add(key)
  return { kind: "assign", target, value, span: s.span }
}
