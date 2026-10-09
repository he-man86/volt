/**
 * SIZEOF and the difference of two addresses in one variable, over the measured byte layout (`storage/bytes.ts`).
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr, Place } from "../../ir/index.js"
import { lookup, targetOf } from "../../../frontend/symbols/index.js"
import { elementaryRef, elementaryTypeOn, resolveNamedType, type Type } from "../../../frontend/types/index.js"
import { storageOf } from "../storage/layout.js"
import { byteOffset, byteSize } from "../storage/bytes.js"
import { lowerPlace } from "../places/places.js"
import { oneArgument } from "./arity.js"
import { adrOperand } from "../pointers/address.js"

/**
 * `SIZEOF(x)` of a variable or a type name — its byte size (`bytes`), as a ULINT constant: a SIZEOF widens into a ULINT
 * without a message, measured. A type with an unmeasured part is refused.
 */
export function sizeOf(lw: Lowering, e: Extract<Expr, { kind: "call" }>): IrExpr | undefined {
  const arg = oneArgument(e, { output: true })
  if (arg === undefined) return lw.bail("call-arity", "SIZEOF takes one argument", e.span)
  // XSIZEOF is SIZEOF: the same byte count, and this already answers with the pointer-width integer it returns
  // (conformance `cp_xsizeof`: XSIZEOF and SIZEOF agree on a variable, an array and a type).
  const named = arg.kind === "ident_expr" && !lw.holds(arg.name) ? lookup(lw.scope, arg.name)?.symbol : undefined
  // `SIZEOF(DINT)` / `XSIZEOF(DINT)` — an ELEMENTARY type name, which resolves to no symbol at all and so fell through
  // to `lowerPlace` and its "does not resolve" (conformance `cp_xsizeof`: XSIZEOF(DINT) is 4).
  const elementary = arg.kind === "ident_expr" && !lw.holds(arg.name) && named === undefined ? elementaryTypeOn(arg.name, targetOf(lw.project)) : undefined
  let type: Type
  if (elementary !== undefined) type = elementaryRef(elementary.name)
  else if (named?.kind === "type" || named?.kind === "function_block") type = storageOf(lw, resolveNamedType(named.name, lw.project), arg.span)
  else {
    const place = lowerPlace(lw, arg)
    if (place === undefined) return undefined
    type = place.type
  }
  const bytes = byteSize(lw, type)
  if (bytes === undefined) return lw.bail("sizeof-unmeasured", "SIZEOF of a type whose layout is not measured", e.span)
  return { kind: "const", value: bytes.size, type: elementaryRef("ULINT"), span: e.span }
}

/**
 * `ADR(a) - ADR(b)` of two places in ONE variable — a constant, the difference of their byte offsets (conformance
 * `mem_member_offsets`). Undefined when the expression is not that shape; null when it is but an offset is not measured
 * (reported), so the caller does not report it a second time.
 */
export function adrDifference(lw: Lowering, e: Extract<Expr, { kind: "binary" }>): IrExpr | null | undefined {
  const [a, b] = [adrOperand(e.left, { parens: false }), adrOperand(e.right, { parens: false })]
  if (a === undefined || b === undefined) return undefined
  const lowered = [lowerPlace(lw, a), lowerPlace(lw, b)]
  if (lowered[0] === undefined || lowered[1] === undefined) return null
  // a place reached through a pointer that holds an address (root "image", slot 0, path [] — `pointers/deref.ts`) names
  // no variable here: two of them are not "one variable", and `byteOffset` would walk an empty path to 0 (review 4d gate:
  // `ADR(p^) - ADR(q^)` was folded to 0). Its offset is known only at run time, and an ADR as an integer operand is not
  // lowered, so refused by name (0 ADR differences of any shape in the six corpora).
  if (lowered[0].root === "image" || lowered[1].root === "image") {
    lw.bail("adr-offset", "a difference of addresses through a dereferenced pointer", e.span)
    return null
  }
  // two places in ONE variable are measured inside it; only two DIFFERENT variables are moved onto the instance — so an
  // FB whose own layout is not measured (a pointer field, an in-out, a VAR_TEMP) still answers `ADR(arr[2]) - ADR(arr[0])`
  const same = lowered[0].slot === lowered[1].slot && lowered[0].root === lowered[1].root
  const [left, right] = same ? lowered : lowered.map((p) => onInstance(lw, p!))
  if (left === undefined || right === undefined) return null
  const [from, to] = [byteOffset(lw, left), byteOffset(lw, right)]
  if (left.slot !== right.slot || left.root !== right.root || from === undefined || to === undefined || from < to) {
    lw.bail("adr-offset", "a difference of addresses whose byte offsets are not measured", e.span)
    return null
  }
  return { kind: "const", value: from - to, type: elementaryRef("ULINT"), span: e.span }
}

/** An FB, METHOD or ACTION body's own field as a step on `THIS^` — so `ADR(loc) - ADR(THIS^)` is two places in ONE
 *  variable, the instance (`fb_header_offsets_plain`: 32). Any other place as it is. Asked only of two places in
 *  different variables (review 4d). */
function onInstance(lw: Lowering, place: Place): Place {
  if (place.root !== undefined || lw.selfType?.kind !== "function_block") return place
  return { ...place, root: "this", slot: 0, path: [{ kind: "field", name: lw.slots[place.slot]!.name }, ...place.path] }
}
