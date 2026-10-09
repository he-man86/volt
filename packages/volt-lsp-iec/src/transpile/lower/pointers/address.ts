/**
 * An address as a pointer's value: `ADR(x)`, an element's address, and pointer arithmetic.
 */

import type { Lowering } from "../core/lowering.js"
import { exprText, type Expr, type Span } from "../../../frontend/syntax/index.js"
import { elementaryRef, peelArray, type Type } from "../../../frontend/types/index.js"
import type { IrExpr, Place } from "../../ir/index.js"
import { ELEMENT_TAG_BIAS, pointerFrame, pointerKey, type PointerTarget, pointerTargets, refuseAfterStore } from "./state.js"
import { lowerPlace } from "../places/places.js"
import { refuseUnionWrite } from "../storage/unions.js"
import { storageOf } from "../storage/layout.js"
import { charsOf } from "./cursor.js"
import { sameStorage } from "../places/path.js"
import { binaryOf, cast } from "../core/build.js"
import { convert } from "../values/convert.js"
import { describePointer, unsuppliedInput, unsuppliedRoot } from "./deref.js"
import { byteSize } from "../storage/bytes.js"
import { constantValue } from "../../semantics/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { NO_TAG } from "../core/tags.js"
import { escapeKey, type Holder, holderOf, holdsAddresses, noteAnyAddress, noteCopy, noteStore } from "./escape.js"
import { anyHolder } from "./any.js"
import { isNew, refuseDynamicMemory } from "../builtins/system.js"

/** `ADR(x)` or the right side of `REF=` — the pointer's value (1, or element index + ELEMENT_TAG_BIAS) and its target. */
export function addressOf(lw: Lowering, x: Expr, pointerType: Type, span: Span): { value: IrExpr; target: PointerTarget } | undefined {
  if (pointerType.kind !== "pointer" && pointerType.kind !== "reference") return lw.bail("pointer-shape", "an address stored into something that is not a pointer", span)
  const place = lowerPlace(lw, x)
  // TAKING AN ADDRESS IS A READ. The shared refusal's default message says "a write into a UNION member", which is
  // not what `ADR(u.member)` or `REF= u.member` does — and a message that describes the wrong operation sends the
  // reader looking for an assignment that is not there.
  if (place === undefined || refuseUnionWrite(lw, place, span, "the address of a UNION member, whose overlay a pointer would not follow"))
    return undefined
  if (place.guard !== undefined || place.path.some((s) => s.kind === "bit"))
    return lw.bail("pointer-shape", "the address of a dereference or a bit", span)
  const last = place.path.at(-1)
  // The target is kept as a place and replayed at every dereference, so an index in it would be read again then — after
  // `p := ADR(arr[i].x); i := 3`, `p^` followed i to arr[3] where the address was taken at arr[1] (transpiler review
  // 2026-09-15). Only the LAST index is captured, as the element the value holds; a runtime index before it is refused.
  const before = last?.kind === "index" ? place.path.slice(0, -1) : place.path
  if (before.some((s) => s.kind === "index" && s.index.kind !== "const"))
    return lw.bail("pointer-runtime-index", "the address of a place with a runtime index before its last step", span)
  // A POINTER TO BYTE over an INT acted on the whole INT: a dereference takes its target's type. Only an address of the
  // pointer's own target type is modelled — a byte walk over another type is the unmeasured byte view (design §9).
  const declared = storageOf(lw, pointerType.target, span)
  if (last?.kind !== "index") {
    // A POINTER TO BYTE OVER A STRING walks its n + 1 bytes (`tr_34_lib_prim_char_behind`: `p := ADR(u); p[4] := 67`
    // stores behind the terminator) — its characters, exactly as a string cursor's, and valued the same: offset + 1.
    const unit = charsOf(place.type)
    if (unit !== undefined && sameStorage(declared, unit))
      return { value: { kind: "const", value: 1n, type: pointerType, span }, target: { base: place, chars: unit } }
    if (!sameStorage(declared, place.type)) return lw.bail("pointer-type", "the address of a variable of another type than the pointer's", span)
    return { value: { kind: "const", value: 1n, type: pointerType, span }, target: { base: place } }
  }
  if (x.kind !== "index" || x.indices.length !== 1) return lw.bail("pointer-shape", "the address of an element of a multi-dimensional array", span)
  const base = lowerPlace(lw, x.base)
  const array = base === undefined ? undefined : peelArray(base.type)
  if (base === undefined) return undefined
  // an `ARRAY[*]` in-out's element: its lower bound is the call's, not a constant — unmodelled. It returned undefined with
  // no diagnostic, and the whole store vanished (review of batch 3b).
  if (array === undefined) return lw.bail("pointer-shape", "the address of an element of an ARRAY[*]", span)
  if (!sameStorage(declared, array.element)) return lw.bail("pointer-type", "the address of an element of another type than the pointer's", span)
  const lint = elementaryRef("LINT")
  const offset = binaryOf("sub", convert(last.index, lint), { kind: "const", value: array.lower - ELEMENT_TAG_BIAS, type: lint, span }, lint, span)
  return { value: cast(offset, pointerType), target: { base, element: { lower: array.lower, length: array.length, type: array.element } } }
}

/** A value stored into a pointer: `0`, `ADR(x)`, another pointer, or one stepped by whole elements (`p + SIZEOF(T)`). */
export function pointerValue(lw: Lowering, e: Expr, pointerType: Type): { value: IrExpr; target?: PointerTarget } | undefined {
  if (e.kind === "paren") return pointerValue(lw, e.inner, pointerType)
  if (e.kind === "literal" && e.value === 0n) return { value: { kind: "const", value: BigInt(NO_TAG), type: pointerType, span: e.span } }
  if (isNew(e)) return refuseDynamicMemory(lw, e.span)
  const adr = adrOperand(e)
  if (adr !== undefined) return addressOf(lw, adr, pointerType, e.span)
  // `anyArg.pValue` — the address of the variable the call passed. An ANY input is a hidden VAR_IN_OUT bound to it, per
  // call site (`calls.ts`), so the "address" is that parameter: one target, form 1, and the write lands in the caller's
  // own variable at its own width (conformance `state_any_int_pointer_increment`).
  if (e.kind === "member" && e.base.kind === "ident_expr" && pointerFrame(lw).anyInputs.has(e.base.name.toUpperCase()) && e.member.name.toUpperCase() === "PVALUE") {
    const slot = pointerFrame(lw).anyTargets.get(e.base.name.toUpperCase())
    if (slot === undefined) return lw.bail("any-input", `${e.base.name}.pValue, whose argument this call site does not name as a variable`, e.span)
    const base: Place = { slot, path: [], type: lw.inoutSlots[slot]!.type, span: e.span, root: "inout" }
    return { value: { kind: "const", value: 1n, type: pointerType, span: e.span }, target: { base } }
  }
  const stepped = e.kind === "binary" && (e.op === "+" || e.op === "-") ? e : undefined
  const operand = stepped?.left ?? e
  if (operand.kind !== "ident_expr" && operand.kind !== "member" && operand.kind !== "index")
    return lw.bail("pointer-value", "a pointer value this does not model", e.span)
  const source = lowerPlace(lw, operand)
  if (source === undefined) return undefined
  // AN INTEGER STORED AS A POINTER (`q := lw`, an LWORD holding an address) is a BYTE VIEW, the same fact as storing a
  // pointer into an integer — it said `pointer-order`, "the pointer variable lw copied before any address was stored
  // into it", naming an LWORD a pointer and filing a byte-view question under the cross-frame ones (4b).
  if (source.type.kind === "elementary")
    return lw.bail("pointer-value", `an integer (${exprText(operand)}) stored as a pointer — its value is a byte address`, e.span)
  const key = source.type.kind === "pointer" ? pointerKey(lw, source) : undefined
  const targets = key === undefined ? undefined : pointerTargets(lw).get(key)
  // COPYING a multi-target pointer is not built: the copy would have to carry every arm, and its own reads would
  // select over them. Form 3 covers the pointer that HOLDS several targets, not yet the one copied from it.
  if (targets !== undefined && targets.length > 1)
    return lw.bail("pointer-targets", `${describePointer(lw, source)} names more than one variable and is copied — the copy's own arms are not built`, e.span)
  const target = targets?.[0]
  // the COPY path reaches it first: the corpus writes `start1 := adr_bit0_Of_Byte` and only then `start1^`, so a
  // guard on the dereference alone never sees the input (see `unsuppliedInput`)
  if (target === undefined) {
    if (refuseAfterStore(lw, key, describePointer(lw, source), "copied", e.span)) return undefined
    return unsuppliedInput(lw, source, e.span) ?? lw.bail("pointer-order", `${describePointer(lw, source)} copied before any address was stored into it`, e.span)
  }
  const loaded: IrExpr = { kind: "load", place: source, type: source.type, span: operand.span }
  if (stepped === undefined) return { value: convert(loaded, pointerType), target }
  // measured: `p + SIZEOF(T)` is the next element (conformance `mem_pointer_index_struct_array`) — a step of whole elements
  const bytes = lowerExpr(lw, stepped.right)
  const size = target.element === undefined ? undefined : byteSize(lw, target.element.type)?.size
  if (bytes === undefined) return undefined
  // `size === 0n` is guarded SEPARATELY from `undefined`, and it is reachable: `byteSize` answers 0 for a
  // struct with no laid-out fields (`fieldBytes` starts at offset 0, align 1, so `alignUp(0n, 1n)` is 0) and for
  // an array of length 0 (`element.size * 0n`). `% 0n` and `/ 0n` both throw RangeError on BigInt, so
  // `p + 4` over an `ARRAY[0..2] OF <empty struct>` came out of lowering as "0 is an invalid divisor value" —
  // a throw where the contract promises a coded diagnostic.
  if (size === 0n)
    return lw.bail("pointer-step", "a pointer stepped over an element type that occupies no bytes", e.span)
  // WHAT THE STEP IS WAITING ON, named exactly — the two cases are different work and this said the same thing
  // about both. A pointer whose target is an ARRAY ELEMENT can be stepped, and a step that is not a whole
  // multiple of the element is the message below. A pointer to a SINGLE variable has no element to step: walking
  // it needs the byte-addressable view design.md §9 names as its edge, and saying "not whole elements of its
  // array" about it names an array that does not exist. Measured (pointer-model.md §3): 88 stepped uses in the
  // corpus, almost all of them two FBs walking a byte's bits (`adr_bit0_Of_Byte + 1 … + 7`) — every one of those
  // is this case, not the other, and reading the old message would send a reader to look for the array.
  if (target.element === undefined || size === undefined)
    return lw.bail(
      "pointer-step",
      "a pointer to a single variable stepped by bytes, which needs the byte-addressable view (design §9)",
      e.span,
    )
  // `2 * SIZEOF(INT)` is as constant as `SIZEOF(INT)`: the step is FOLDED, not required to be a single literal
  const count = constantValue(bytes)
  if (typeof count !== "bigint" || count % size !== 0n)
    return lw.bail("pointer-step", "a pointer stepped by something other than whole elements of its array", e.span)
  const step: IrExpr = { kind: "const", value: count / size, type: pointerType, span: stepped.right.span }
  return { value: binaryOf(stepped.op === "+" ? "add" : "sub", loaded, step, pointerType, e.span), target }
}

// ─── a pointer that holds addresses into the image (design.md §3.3 step 4d) ─────────────────────────────────────────

/**
 * A value stored into a pointer that holds ADDRESSES (`escape.holdsAddresses`): `0`; `ADR(x)` of a variable the image
 * holds — its byte address; another such pointer; or either stepped by a number of BYTES (`p + SIZEOF(INT)`, `ADR(sv) + 5`),
 * as CODESYS steps a pointer. What it is given is recorded for the escape pass (`noteStore`, `noteCopy`): the address of
 * something the image cannot hold makes the pointer one that holds tags, decided before the bodies lower again.
 */
export function addressValue(lw: Lowering, e: Expr, pointer: Holder): IrExpr | undefined {
  const pointerType = pointer.type
  if (e.kind === "paren") return addressValue(lw, e.inner, pointer)
  if (e.kind === "literal" && e.value === 0n) return { kind: "const", value: 0n, type: pointerType, span: e.span }
  if (isNew(e)) return refuseDynamicMemory(lw, e.span)
  const adr = adrOperand(e)
  if (adr !== undefined) return imageAddressOf(lw, adr, pointer, e.span)
  // `anyArg.pValue` stored here is the argument's image ADDRESS (`tr_17_any_pvalue_*`, design.md §3.3 step 4e): the
  // variant's hidden POINTER input, which each call site fills (`any.bindAnyAddress`) — from the lowering after the one
  // that first sees this store, which is when the call sites learn to (`noteAnyAddress`)
  if (e.kind === "member" && e.base.kind === "ident_expr" && pointerFrame(lw).anyInputs.has(e.base.name.toUpperCase()) && e.member.name.toUpperCase() === "PVALUE") {
    const input = e.base.name.toUpperCase()
    if (!pointerFrame(lw).anyTargets.has(input) && !pointerFrame(lw).anyAddresses.has(input)) {
      noteStore(lw, pointer, undefined)
      return lw.bail("any-input", `${e.base.name}.pValue, whose argument this call site does not name as a variable`, e.span)
    }
    const holder = anyHolder(lw.routineContext.slice("ROUTINE:".length), input)
    noteAnyAddress(lw, holder)
    noteCopy(lw, pointer, holder)
    const given = pointerFrame(lw).anyAddresses.get(input)
    if (given === undefined) return lw.bail("any-input", `${e.base.name}.pValue stored into a pointer that holds addresses, before its call sites hand an address`, e.span)
    return convert({ kind: "load", place: { slot: given.slot, path: [], type: lw.localSlots[given.slot]!.type, span: e.span, root: "local" }, type: lw.localSlots[given.slot]!.type, span: e.span }, pointerType)
  }
  if (e.kind === "binary" && (e.op === "+" || e.op === "-")) {
    const from = addressValue(lw, e.left, pointer)
    const bytes = from === undefined ? undefined : lowerExpr(lw, e.right)
    if (from === undefined || bytes === undefined) return undefined
    if (bytes.type.kind !== "elementary") return lw.bail("pointer-value", "a pointer stepped by something that is not a number of bytes", e.span)
    return binaryOf(e.op === "+" ? "add" : "sub", from, cast(bytes, pointerType), pointerType, e.span)
  }
  if (e.kind !== "ident_expr" && e.kind !== "member" && e.kind !== "index") return lw.bail("pointer-value", "a pointer value this does not model", e.span)
  const source = lowerPlace(lw, e)
  if (source === undefined) return undefined
  if (source.type.kind === "elementary")
    return lw.bail("pointer-value", `an integer (${exprText(e)}) stored as a pointer — its value is a byte address`, e.span)
  if (source.type.kind !== "pointer") return lw.bail("pointer-value", "a pointer value this does not model", e.span)
  noteCopy(lw, pointer, holderOf(lw, source, ""))
  if (!holdsAddresses(lw, source)) return lw.bail("pointer-targets", `${describePointer(lw, source)} holds a tag, copied into a pointer that holds addresses`, e.span)
  if (unsuppliedRoot(lw, source, e.span)) return undefined
  return convert({ kind: "load", place: source, type: source.type, span: e.span }, pointerType)
}

/**
 * TWO ADDRESSES COMPARED — a pointer that holds addresses, or `ADR(x)` of a variable the image holds, on either side:
 * `=`/`<>` compare the addresses; `<`, `<=`, `>`, `>=` ORDER them, inside one region only (`address_order`; across two
 * the order is our layout's, which faults by name — `pointer_order_compare`). `null` when the comparison is not that
 * shape — a pointer that holds tags, `p = 0` — so the caller goes on as before.
 */
export function pointerCompare(lw: Lowering, e: Extract<Expr, { kind: "binary" }>): IrExpr | undefined | null {
  const ops: Readonly<Record<string, "eq" | "ne" | "lt" | "le" | "gt" | "ge">> = { "=": "eq", "<>": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" }
  const op = ops[e.op]

  if (op === undefined || !isAddress(lw, e.left) || !isAddress(lw, e.right)) return null
  const left = addressOperand(lw, e.left)
  const right = left === undefined ? undefined : addressOperand(lw, e.right)
  if (left === undefined || right === undefined) return undefined
  const bool = elementaryRef("BOOL")
  if (op === "eq" || op === "ne") return { kind: "binary", op, left, right: convert(right, left.type), type: bool, span: e.span }
  const dint = elementaryRef("DINT")
  const order: IrExpr = { kind: "builtin", name: "address_order", args: [left, convert(right, left.type)], type: dint, span: e.span }
  return { kind: "binary", op: op!, left: order, right: { kind: "const", value: 0n, type: dint, span: e.span }, type: bool, span: e.span }
}

/** Whether one side of a comparison is an ADDRESS: `ADR(x)` of a variable the image holds (or of an image place), or a
 *  pointer that holds addresses — asked before anything is lowered for real, so a comparison of tags goes on as before. */
function isAddress(lw: Lowering, e: Expr): boolean {
  if (e.kind === "paren") return isAddress(lw, e.inner)
  const adr = adrOperand(e)
  const shaped = adr !== undefined || e.kind === "ident_expr" || e.kind === "member" || e.kind === "index"
  if (!shaped) return false
  const before = lw.diagnostics.length
  const place = lowerPlace(lw, adr ?? e)
  lw.diagnostics.length = before
  if (place === undefined) return false
  if (adr !== undefined) return place.root === "image" || escapeKey(lw, place) !== undefined
  return place.type.kind === "pointer" && holdsAddresses(lw, place)
}

/** One side of `pointerCompare` (`isAddress` said it is one), lowered: the address. */
function addressOperand(lw: Lowering, e: Expr): IrExpr | undefined {
  if (e.kind === "paren") return addressOperand(lw, e.inner)
  const adr = adrOperand(e)
  if (adr !== undefined) return imageAddressOf(lw, adr, undefined, e.span)
  const place = lowerPlace(lw, e)
  return place && { kind: "load", place, type: place.type, span: e.span }
}

/** `ADR(x)` stored into `pointer` (compared, when there is none): x's byte address in the image — refused when the image
 *  cannot hold x (it keeps a tag). */
export function imageAddressOf(lw: Lowering, x: Expr, pointer: Holder | undefined, span: Span): IrExpr | undefined {
  const place = lowerPlace(lw, x)
  // TAKING AN ADDRESS IS A READ (`addressOf` says why the union refusal names it)
  if (place === undefined || refuseUnionWrite(lw, place, span, "the address of a UNION member, whose overlay a pointer would not follow")) return undefined
  if (place.path.some((s) => s.kind === "bit")) return lw.bail("pointer-shape", "the address of a bit", span)
  // `ADR(p^)` of a pointer into the image is where `p` points: already an image place, so nothing escapes
  const type: Type = pointer?.type ?? { kind: "pointer", target: place.type }
  if (place.root === "image") return { kind: "address", place, type, span }
  if (place.guard !== undefined) return lw.bail("pointer-shape", "the address of a dereference", span)
  noteStore(lw, pointer, place)
  if (escapeKey(lw, place) === undefined)
    return lw.bail("pointer-targets", `${pointer === undefined ? "an address compared" : `${pointer.name} holds addresses, and`} ${exprText(x)} is not in the image — a routine's local, a VAR_IN_OUT's target, a string's characters or an instance keep a tag`, span)
  return { kind: "address", place, type, span }
}

/**
 * THE ONE ADR RECOGNIZER (transpile-restructure 1.7.9): the operand `x` of an `ADR(x)` — a call of `ADR` with one argument,
 * whatever that argument is written as — or undefined. Through parentheses `(ADR(x))` by default; `ADR(a) - ADR(b)`
 * (`builtins/sizeof.adrDifference`) recognizes only the bare call, as it always has (`parens: false`).
 */
export function adrOperand(value: Expr | undefined, { parens = true }: { parens?: boolean } = {}): Expr | undefined {
  if (value === undefined) return undefined
  if (value.kind === "paren" && parens) return adrOperand(value.inner)
  return value.kind === "call" && value.callee.kind === "ident_expr" && value.callee.name.toUpperCase() === "ADR" && value.args.length === 1
    ? value.args[0]!.value
    : undefined
}
