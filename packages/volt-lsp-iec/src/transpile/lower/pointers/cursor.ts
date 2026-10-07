/**
 * STRING cursors: a POINTER TO BYTE (or WORD) walking a string's characters.
 */

import { elementaryRef, elemOf, type Type } from "../../../frontend/types/index.js"
import type { Lowering } from "../lowering.js"
import type { IrBinding, IrExpr, Place } from "../../ir/index.js"
import { type Cursor, pointerKey } from "./state.js"
import type { CallArg, Expr, Span, TopLevel } from "../../../frontend/syntax/index.js"
import { binaryOf, cast } from "../core/build.js"
import { convert } from "../values/convert.js"
import { routineFacts } from "../calls/facts.js"
import type { RoutineSymbol } from "../core/lowering.js"
import { findChildScope } from "../../../frontend/symbols/index.js"
import { positionalParameters } from "../calls/parameters.js"
import { adrArgument } from "./address.js"
import { lowerPlace } from "../places/places.js"
import { stringIdentity } from "../places/path.js"
import { pointeePlace } from "./deref.js"
import { callHolds, type InvokeBindings } from "../calls/invoke.js"
import type { InFrame } from "../calls/specialize.js"
import { bindInOut, bindPlace } from "../calls/binding.js"

/** The character type of a STRING (BYTE) or WSTRING (WORD) — undefined for anything else. */
export function charsOf(t: Type): Type | undefined {
  const text = elemOf(t)
  return text?.name === "STRING" ? elementaryRef("BYTE") : text?.name === "WSTRING" ? elementaryRef("WORD") : undefined
}

/** The STRING CURSOR a pointer place is (`Lowering.cursors`) — a bare parameter of this routine — or undefined. */
export function cursorOf(lw: Lowering, pointer: Place): Cursor | undefined {
  if (pointer.root !== "local" || pointer.path.length > 0) return undefined
  const name = lw.localSlots[pointer.slot]?.name.toUpperCase()
  return name === undefined ? undefined : lw.cursors.get(name)
}

/**
 * A STRING CURSOR'S CHARACTER — `p^`, or `p[i]` with `extra` — as the string it walks, the character index and the
 * character's type; null when `pointer` is no cursor. The pointer holds a BYTE offset + 1, as CODESYS pointer
 * arithmetic counts bytes (`p + 1` is the next BYTE, `p + 2` the next WORD), while `p[i]` steps whole characters.
 */
export function cursorChar(lw: Lowering, pointer: Place, extra: IrExpr | undefined, span: Span): { place: Place; index: IrExpr; unit: Type } | null {
  const cursor = cursorOf(lw, pointer)
  if (cursor === undefined) return charsThrough(lw, pointer, extra, span)
  if (elemOf(cursor.unit)?.family === "string") return null
  const text: Place = { slot: cursor.inout, path: [], type: lw.inoutSlots[cursor.inout]!.type, span, root: "inout", guard: pointer }
  return cursorCharAt(pointer, text, cursor.unit, extra, span)
}

/** `p^` / `p[i]` through a POINTER TO BYTE whose one target is a STRING's characters (`PointerTarget.chars`) — null for any
 *  other pointer. Several targets, or one scoped to an in-out's binding, fall through to `pointeePlace`, which refuses them. */
function charsThrough(lw: Lowering, pointer: Place, extra: IrExpr | undefined, span: Span): { place: Place; index: IrExpr; unit: Type } | null {
  const key = pointer.type.kind === "pointer" ? pointerKey(lw, pointer) : undefined
  const targets = key === undefined ? undefined : lw.shared.pointers.get(key)
  const target = targets?.length === 1 ? targets[0]! : undefined
  if (target?.chars === undefined || target.scopedTo !== undefined) return null
  return cursorCharAt(pointer, { ...target.base, guard: pointer, span }, target.chars, extra, span)
}

/** `p^[i]` on a `POINTER TO STRING` (WSTRING) cursor — the i-th character counted from where the cursor stands, which is
 *  where the string `p^` names begins. Null when `pointer` is no such cursor. */
export function cursorStringChar(lw: Lowering, pointer: Place, extra: IrExpr, span: Span): { place: Place; index: IrExpr; unit: Type } | null {
  const cursor = cursorOf(lw, pointer)
  const text = cursor === undefined ? undefined : elemOf(cursor.unit)
  if (cursor === undefined || text?.family !== "string") return null
  const place: Place = { slot: cursor.inout, path: [], type: lw.inoutSlots[cursor.inout]!.type, span, root: "inout", guard: pointer }
  return cursorCharAt(pointer, place, elementaryRef(text.name === "WSTRING" ? "WORD" : "BYTE"), extra, span)
}

/** The character a pointer's byte offset, plus `extra` characters, names in the string `text` it walks — guarded by the
 *  pointer: one handed a null pointer is bound all the same, and faults HERE, where it is dereferenced, as form 1's `p^` does. */
function cursorCharAt(pointer: Place, text: Place, unit: Type, extra: IrExpr | undefined, span: Span): { place: Place; index: IrExpr; unit: Type } {
  const lint = elementaryRef("LINT")
  const n = (value: bigint): IrExpr => ({ kind: "const", value, type: lint, span })
  const width = elemOf(unit)?.name === "WORD" ? 2n : 1n
  let index = binaryOf("sub", cast({ kind: "load", place: pointer, type: pointer.type, span }, lint), n(1n), lint, span)
  if (width > 1n) index = binaryOf("div", index, n(width), lint, span)
  if (extra !== undefined) index = binaryOf("add", index, convert(extra, lint), lint, span)
  return { place: text, index, unit }
}

/**
 * The string a `POINTER TO STRING` cursor's `p^` is — the caller's own, bound whole. Undefined when `pointer` is no such
 * cursor; null, refused, when it may stand past the string's first character: its `p^` is then the string from there,
 * which is no place the model holds.
 */
export function cursorString(lw: Lowering, pointer: Place, span: Span): Place | null | undefined {
  const cursor = cursorOf(lw, pointer)
  if (cursor === undefined || elemOf(cursor.unit)?.family !== "string") return undefined
  if (cursor.offset) {
    lw.bail("pointer-value", "the whole string behind a POINTER TO STRING that may stand past its first character", span)
    return null
  }
  return { slot: cursor.inout, path: [], type: lw.inoutSlots[cursor.inout]!.type, span, root: "inout", guard: pointer }
}

/** Each routine's STRING CURSOR inputs (`Lowering.cursors`): the input slot index → the hidden VAR_IN_OUT a call binds
 *  the string to. */
export const cursorInputsOf = routineFacts<ReadonlyMap<number, number>>()

/** The prefix of the hidden VAR_IN_OUT a STRING CURSOR input is given — `__ptr_`'s twin. The cursor's own name with a
 *  `^` is registered for it too, a name no ST identifier can spell, so a cursor handed on to another routine binds by it. */
export const CURSOR = "__str_"

/** The string a character pointer walks: STRING under a `POINTER TO BYTE`, WSTRING under a `POINTER TO WORD`. A pointer
 *  to a whole STRING or WSTRING is a cursor too, whose `p^` is that string (`Lowering.cursors`). */
const TEXT_OF: Readonly<Record<string, string>> = { BYTE: "STRING", WORD: "WSTRING" }

/**
 * THE STRING EACH CHARACTER-POINTER INPUT OF THIS CALL WALKS (`Lowering.cursors`), by parameter — from the argument:
 * `ADR(s)` of a string, or a cursor of the caller's own handed on. The routine is lowered once per string TYPE (the
 * variant in its name), so the hidden VAR_IN_OUT is the caller's exact type and its capacity cuts a store in both
 * backends. An argument of any other shape leaves the parameter an ordinary pointer, refused where it is used.
 */
export function cursorArgumentTypes(lw: Lowering, sym: RoutineSymbol, call: Extract<Expr, { kind: "call" }>): Map<string, CursorArgument> {
  const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
  if (ast.kind === "action") return new Map()
  const scope = findChildScope(sym.owner, sym.name) ?? lw.scope
  const parameters = positionalParameters(ast.varSections)
  const out = new Map<string, CursorArgument>()
  const walking = new Map<string, string>()
  for (const [position, arg] of call.args.entries()) {
    const name = arg.param?.name.toUpperCase() ?? parameters[position]?.name.toUpperCase()
    const prm = parameters.find((p) => p.name.toUpperCase() === name)
    if (prm?.sectionKind !== "VAR_INPUT" || arg.output || arg.value === undefined) continue
    const type = lw.resolve(prm.type, scope)
    // a pointer to characters walks a string of that width; a pointer to a whole STRING (WSTRING) of any capacity takes
    // the caller's string as it is — `POINTER TO STRING(255)` given `ADR` of a STRING(80) reads those 80
    const pointee = type.kind === "pointer" ? elemOf(type.target) : undefined
    const text = pointee?.family === "string" ? pointee.name : TEXT_OF[pointee?.name ?? ""]
    if (text === undefined) continue
    const walked = cursorArgument(lw, arg.value)
    if (walked === undefined || elemOf(walked.type)?.name !== text) continue
    // TWO POINTERS INTO ONE STRING share it — `StrMidA(pst := s, pstResult := s)` reads and writes the same buffer, each
    // pointer at its own offset. Two hidden VAR_IN_OUTs would be two `&mut` of `s`, which the alias check refuses.
    const shares = walked.same === undefined ? undefined : walking.get(walked.same)
    if (walked.same !== undefined && shares === undefined) walking.set(walked.same, name!)
    // a whole-string pointer handed a cursor that may have walked stands wherever that one does (`Cursor.offset`)
    out.set(name!, { type: walked.type, shares, offset: pointee?.family === "string" && walked.walked })
  }
  return out
}

/** A cursor input's string; `shares` — the earlier input of the same call whose string it walks too; `offset` — that it
 *  may stand past its string's first character (`Cursor.offset`). */
export interface CursorArgument {
  type: Type
  shares?: string
  offset: boolean
}

/** The string an argument hands a character pointer: `ADR(s)`'s, or the one the caller's own cursor walks. A probe —
 *  what it cannot read, the binding reports. */
function cursorArgument(lw: Lowering, value: Expr): { type: Type; same?: string; walked: boolean } | undefined {
  // the caller's own cursor may have walked — a character cursor can step; a whole-string one cannot, unless it was
  // itself handed one that did
  const own = value.kind === "ident_expr" ? lw.cursors.get(value.name.toUpperCase()) : undefined
  if (own !== undefined)
    return { type: lw.inoutSlots[own.inout]!.type, same: `inout:${own.inout}`, walked: own.offset || elemOf(own.unit)?.family !== "string" }
  const before = lw.diagnostics.length
  const addressed = adrArgument(value)
  const place = lw.inArgument(() => (addressed !== undefined ? lowerPlace(lw, addressed) : pointedString(lw, value)))
  lw.diagnostics.length = before
  const name = place?.type.kind === "elementary" ? place.type.name : undefined
  return name === "STRING" || name === "WSTRING" ? { type: place!.type, same: stringIdentity(place!), walked: false } : undefined
}

/** The string a POINTER VARIABLE argument names — its one recorded target (form 1), reached through it, so a null
 *  pointer still faults — or undefined when the argument is no such pointer. */
function pointedString(lw: Lowering, value: Expr): Place | undefined {
  if (value.kind !== "ident_expr" && value.kind !== "member") return undefined
  const pointer = lowerPlace(lw, value)
  if (pointer?.type.kind !== "pointer") return undefined
  const key = pointerKey(lw, pointer)
  const targets = key === undefined ? undefined : lw.shared.pointers.get(key)
  if (targets?.length !== 1 || targets[0]!.element !== undefined) return undefined
  return pointeePlace(lw, pointer, undefined, value.span)
}

/**
 * A STRING CURSOR input: the string the argument addresses is bound to its hidden VAR_IN_OUT, and the pointer starts at
 * its first character (value 1: byte offset 0) — or, handed on from the caller's own cursor, at wherever that cursor has
 * walked to, over the same string.
 */
export function bindCursorArgument(lw: Lowering, b: InvokeBindings, arg: CallArg, k: number, cursorInOut: number): true | undefined {
  const routine = b.routine
  const param = routine.inouts[cursorInOut]!
  const pointerType = routine.locals[routine.inputs[k]!]!.type
  const addressed = adrArgument(arg.value)
  const own = arg.value?.kind === "ident_expr" && lw.cursors.has(arg.value.name.toUpperCase()) ? arg.value : undefined
  // three sources, each with where the callee starts: `ADR(s)` at the first character; the caller's own cursor where
  // it stands; a pointer variable at its own VALUE — form 1's 1 for the one string it was given, or 0 while it is
  // still null, which the callee's `IF p = 0 THEN RETURN` reads as CODESYS's does (every StringUtils function
  // starts so). The string is bound either way: a null cursor faults where it is DEREFERENCED (`cursorCharAt`'s
  // guard), not where it is passed.
  const pointed = addressed !== undefined || own !== undefined || arg.value === undefined ? undefined : lw.inArgument(() => pointedString(lw, arg.value!))
  if (addressed === undefined && own === undefined && pointed === undefined)
    return lw.bail("pointer-order", `${arg.param!.name} walks a string, and is given something other than ADR(...) of one, a cursor, or a pointer to one`, arg.span)
  const from = own ?? (pointed === undefined ? undefined : arg.value)
  const start: IrExpr =
    from === undefined ? { kind: "const", value: 1n, type: pointerType, span: arg.span } : { kind: "load", place: lowerPlace(lw, from)!, type: pointerType, span: arg.span }
  // a second pointer into a string this call already bound (`CursorArgument.shares`): the string is bound once, and
  // only this pointer's start is its own
  if (b.inouts[cursorInOut] !== undefined) {
    b.inputs[k] = start
    b.order.push(k)
    return true
  }
  let target: IrBinding | InFrame | undefined
  if (addressed !== undefined) target = bindInOut(lw, { ...arg, value: addressed }, param, callHolds(b), routine.body, routine.fb, b.instance)
  else if (own !== undefined)
    target = bindInOut(lw, { ...arg, value: { kind: "ident_expr", name: `${own.name.toUpperCase()}^`, span: own.span } }, param, callHolds(b), routine.body, routine.fb, b.instance)
  else {
    const { guard: _, ...unguarded } = pointed!
    target = bindPlace(lw, unguarded, arg, param, callHolds(b), routine.body, routine.fb, b.instance)
  }
  if (target === undefined) return undefined
  b.inouts[cursorInOut] = target
  b.inputs[k] = start
  b.order.push(k)
  b.order.push({ inout: cursorInOut })
  return true
}
