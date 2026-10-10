/**
 * Expressions → IR: the dispatch — a literal, a name, a dereference, a member or element — and on to the operators,
 * the calls and the places.
 */

import type { Lowering } from "../core/lowering.js"
import { type Expr, isSelfRef } from "../../../frontend/syntax/index.js"
import { elementaryRef, type Type, UNKNOWN } from "../../../frontend/types/index.js"
import type { IrExpr } from "../../ir/index.js"
import { lowerBinary, lowerUnary } from "./operators.js"
import { lowerAccess, lowerPlace } from "../places/places.js"
import {
  calendarOf,
  contextLiteralType,
  durationOf,
  stringLiteralText,
  TEMPORAL_LITERAL_KINDS,
  typedRealOf,
} from "../values/literals.js"
import { retype } from "../values/convert.js"
import { enumConstant } from "../values/enums.js"
import { loadValue } from "../places/access-guards.js"
import { cursorChar } from "../pointers/cursor.js"
import { selectThrough } from "../pointers/deref.js"
import { anyDiSize } from "../pointers/any.js"
import { partialAccess } from "./partial-access.js"
import { lowerBuiltin } from "../builtins/builtins.js"
import { lowerPropertyGet } from "../calls/property.js"

/**
 * Lower one expression to a node with a DEFINITE type.
 *
 * `inferExprType` answers the LSP's question — "what can I safely say this is?" — and returns `UNKNOWN`
 * wherever a wrong answer would be a false positive (`REAL + INT` among them). A backend cannot emit
 * `UNKNOWN`, so the operator types are computed here from the operand types, over the SAME widening lattice
 * `types/elementary` owns (family + rank). Inference still answers the leaves. An expression that lands on
 * `UNKNOWN` anyway is a reported gap, never untyped IR.
 *
 * `stored`: `e` is the WHOLE value of a plain `:=` store into a place of type `expected` (`statements/assign.ts`) — the one
 * context a variable-count shift of an untyped literal was recorded in (`builtins/value-functions.ts` `untypedShiftOperand`).
 */
export function lowerExpr(lw: Lowering, e: Expr, expected?: Type, stored = false): IrExpr | undefined {
  switch (e.kind) {
    case "literal":
      return lowerLiteral(lw, e, expected)
    case "ident_expr":
      return lowerName(lw, e)
    case "deref":
      return lowerDeref(lw, e)
    case "paren":
      return lowerExpr(lw, e.inner, expected, stored)
    case "unary":
      return lowerUnary(lw, e, expected)
    case "binary":
      return lowerBinary(lw, e)
    case "call":
      return lowerBuiltin(lw, e, expected, stored)
    case "member":
    case "index":
      return lowerMember(lw, e)
    default:
      return lw.bail(`expr-${e.kind}`, `${e.kind} is not lowered yet`, e.span)
  }
}

/** A literal: a typed constant — a duration, a calendar value, a typed REAL, a string, or an integer typed by its context. */
function lowerLiteral(lw: Lowering, e: Extract<Expr, { kind: "literal" }>, expected: Type | undefined): IrExpr | undefined {
  // `%IB8` is not a value but a PLACE — the process image with no variable on it (`addressPlace`, conformance
  // `ca_direct_address_expression`). The lexer makes it a literal, so a READ of one lands here.
  if (e.literalKind === "address") {
    const place = lowerPlace(lw, e)
    return place && { kind: "load", place, type: place.type, span: e.span }
  }
  const v = e.value
  if (v === undefined) return lw.bail("bad-literal", `malformed literal ${e.text}`, e.span)
  const typed = durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)
  if (typed !== undefined) return { kind: "const", value: typed.value, type: typed.type, span: e.span }
  // A temporal literal that did not convert is REPORTED here and goes no further. Falling through let
  // `D#300000-01-01` reach the string branch below — a date literal's AST value is the string
  // "300000-01-01" — and become a STRING constant with no diagnostic.
  if (TEMPORAL_LITERAL_KINDS.has(e.literalKind))
    return lw.bail("bad-literal", `${e.literalKind} literal outside the representable range: ${e.text}`, e.span)
  if (typeof v === "string") {
    const text = stringLiteralText(lw, e)
    if (text === null) return undefined
    const base = elementaryRef(e.literalKind === "wstring" ? "WSTRING" : "STRING")
    return { kind: "const", value: text, type: { ...base, length: text.length } as Type, span: e.span }
  }
  // An IEC integer literal has NO intrinsic type — it takes the one the context requires, which is
  // exactly why `inferExprType` returns UNKNOWN for it. Context first; the narrowest type that holds
  // the value otherwise, so a bare literal still meets its neighbour cleanly.
  const type = contextLiteralType(e, expected)
  if (type === UNKNOWN) return lw.bail("type-unknown", `the type of ${e.text} is not resolvable`, e.span)
  return retype({ kind: "const", value: typeof v === "object" ? v.ns : v, type, span: e.span }, type)
}

/** A bare name: a PROPERTY's getter, an enumerator, or the value of the variable it names. */
function lowerName(lw: Lowering, e: Extract<Expr, { kind: "ident_expr" }>): IrExpr | undefined {
  // `P` bare inside an FB, when P is its PROPERTY: the getter (conformance `state_property_get_set`)
  const property = lowerPropertyGet(lw, e)
  if (property !== null) return property
  const enumValue = lw.holds(e.name) ? undefined : enumConstant(lw, e)
  if (enumValue !== undefined) return enumValue
  const place = lowerPlace(lw, e)
  if (place === undefined) return undefined
  if (place.type === UNKNOWN) return lw.bail("type-unknown", `the type of ${e.name} is not resolvable`, e.span)
  return loadValue(lw, place, e.span)
}

/** `p^`: a string cursor's character, a read selected on a multi-target pointer's tag, or the one place it names. */
function lowerDeref(lw: Lowering, e: Extract<Expr, { kind: "deref" }>): IrExpr | undefined {
  // FORM 3 FIRST: a pointer naming several variables has no single place to load from, so the READ selects on
  // its tag. `lowerPlace` below is form 1's erasure and stays the common case — `selectThrough` answers
  // undefined whenever there is one target, which is nearly always.
  const pointer = isSelfRef(e) ? undefined : lowerPlace(lw, e.base)
  // a STRING CURSOR'S `p^` is the character it stands on (`char`)
  const char = pointer === undefined ? null : cursorChar(lw, pointer, undefined, e.span)
  if (char !== null) return { kind: "builtin", name: "char", args: [{ kind: "load", place: char.place, type: char.place.type, span: e.span }, char.index], type: char.unit, span: e.span }
  if (pointer !== undefined && pointer.type.kind === "pointer") {
    const selected = selectThrough(lw, pointer, e.span)
    if (selected !== undefined) return selected
  }
  const place = lowerPlace(lw, e)
  return place && loadValue(lw, place, e.span)
}

/** `a.b` / `a[i]`: an ANY input's size, an enumerator, a partial access, a PROPERTY's getter, a string's character, or
 *  the value of the place. */
function lowerMember(lw: Lowering, e: Extract<Expr, { kind: "member" | "index" }>): IrExpr | undefined {
  if (e.kind === "member") {
    const size = anyDiSize(lw, e)
    if (size !== null) return size
    const enumValue = enumConstant(lw, e)
    if (enumValue !== undefined) return enumValue
    const partial = partialAccess(lw, e)
    if (partial !== null) return partial
    // `inst.P` / `THIS^.P` on a PROPERTY: its getter, run on the instance
    const property = lowerPropertyGet(lw, e)
    if (property !== null) return property
  }
  const indexed = e.kind === "index" ? lowerAccess(lw, e, "expr-index") : { place: lowerPlace(lw, e, "expr-member") }
  if (indexed === undefined) return undefined
  // `s[i]`: one character read out of the string (`char`)
  if ("char" in indexed) {
    const { place: text, index, unit } = indexed.char
    return { kind: "builtin", name: "char", args: [{ kind: "load", place: text, type: text.type, span: e.span }, index], type: unit, span: e.span }
  }
  const place = indexed.place
  if (place === undefined) return undefined
  if (place.type === UNKNOWN) return lw.bail("type-unknown", "the type of a member is not resolvable", e.span)
  return loadValue(lw, place, e.span)
}
