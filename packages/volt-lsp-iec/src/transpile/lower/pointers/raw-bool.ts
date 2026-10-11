/**
 * A RAW BOOL (transpile-restructure 8.2, design.md §7.2 Decision step 8c): a BOOL whose byte a store of another type can
 * reach — its address stored into a pointer of another target type (model 3's escape set) — or one a flow that keeps the
 * byte fills from such a BOOL. CODESYS keeps the BOOL's whole byte and every operator acts on it as recorded
 * (`bool_byte_two_through_pointer`, `bool_byte_ops`, record:exec 2026-10-09 and 2026-10-11, the bytes 2, 3 and 255):
 *
 *   AND / OR / XOR       the bytes, bitwise — 2 AND TRUE is 0, 2 OR FALSE 2, 255 XOR TRUE 254
 *   NOT                  bit 0 inverted, the rest cleared — NOT 2 is 1 (TRUE), NOT 3 and NOT 255 are 0
 *   = / <>               the bytes compared — 2 = TRUE is FALSE, 2 <> FALSE TRUE, 2 = 3 FALSE
 *   IF                   taken when the byte is not 0
 *   BOOL_TO_INT / BYTE   bit 0 — 2 is 0, 3 and 255 are 1
 *   a copy, an input     the byte, kept: `c := b`, a FUNCTION's VAR_INPUT, an FB's VAR_INPUT (in the call or `inst.x := b`),
 *                        MOVE, and a FUNCTION's VAR_IN_OUT (which reads the caller's byte) hold 2, and `c = TRUE` there
 *                        is FALSE (`bool_byte_flow_*`, gate 8c)
 *   a POINTER TO BOOL    over what is no plain BOOL's byte — a BYTE, a WORD, an ARRAY OF BYTE, a raw BOOL, a pointer of
 *                        another type copied into it — reads the byte, by the same table (`bool_pointer_over_bytes`,
 *                        `byte_pointer_copied_to_bool_pointer`); a POINTER TO BOOL copied into one of another type makes
 *                        the BOOLs it holds raw (`bool_pointer_copied_to_byte_pointer`)
 *
 * So a raw BOOL is HELD AS ITS BYTE (`IrSlot.rawBool`, its slot a BYTE), a POINTER TO BOOL that reads a byte (a BYTE VIEW)
 * dereferences as a BYTE (`deref.ts` `imageDeref`), and each of those is lowered on the byte — a byte operator, a
 * comparison, `(x AND 1) = 0`, `x <> 0`, `x AND 1`; every other BOOL keeps `bool` / `boolean`. Which BOOLs are raw and which
 * pointers are byte views is the escape pass's answer (`bool-views.ts`): the seeds an address store names, the addresses
 * a copy carries, then every BOOL a recorded flow fills from a raw one's byte, to a fixed point. A raw BOOL read anywhere
 * else — an operator, a condition or a conversion not in the table, a destination the flow cannot name — is refused
 * `bool-byte` by name (`refuseUnmeasuredRawBools`): its byte's meaning there is unmeasured; so is a BOOL's byte no key can
 * follow (`refusedBoolAddress`, `refusedBoolCopy`, `refusedBoolLent`).
 */
import type { Span } from "../../../frontend/syntax/index.js"
import { elementaryRef, elemOf, type Type } from "../../../frontend/types/index.js"
import type { IrBinOp, IrBinding, IrExpr, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { forEachExpr } from "../../ir/walk.js"
import type { Lowering } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"
import { convert } from "../values/convert.js"
import { slotOf } from "../places/access-guards.js"
import { escapesOf, type Holder, noteBoolAddress, noteBoolFlow, noteBoolSeed, noteByteView, variableKey } from "./escape.js"
import { isPlainBool, viewKey, viewsBool } from "./bool-views.js"
import { sameStorage } from "../places/path.js"

const BOOL = elementaryRef("BOOL")
const BYTE = elementaryRef("BYTE")

/** The expressions that are a raw BOOL's byte, and those a measured operator took — per POU. */
const rawState = sharedState(() => ({ raw: new WeakSet<IrExpr>(), taken: new WeakSet<IrExpr>() }))

const marked = (lw: Lowering, e: IrExpr): IrExpr => {
  rawState(lw).raw.add(e)
  return e
}

/** Whether `e` is a raw BOOL's byte. */
export const isRawBool = (lw: Lowering, e: IrExpr): boolean => rawState(lw).raw.has(e)

/** A BOOL operand as the byte a measured operator takes: a raw one as it is, a plain one as its 0 or 1. */
function byteOf(lw: Lowering, e: IrExpr): IrExpr {
  if (!isRawBool(lw, e)) return convert(e, BYTE)
  rawState(lw).taken.add(e)
  return e
}

/**
 * The slot a declaration makes, when the escape answer names it raw (`key`, as `escape.variableKey` names it): a BYTE,
 * marked `rawBool`, its initial value the byte of the BOOL's. Undefined for any other declaration.
 */
export function rawBoolSlot(lw: Lowering, name: string, type: Type, perRun: boolean): Pick<IrSlot, "type" | "rawBool"> | undefined {
  if (!isPlainBool(type)) return undefined
  const key = lw.globalMode ? `GLOBAL.${name.toUpperCase()}` : `${perRun ? lw.routineContext : lw.frameContext}.${name.toUpperCase()}`
  return escapesOf(lw).rawBools.has(key) ? { type: BYTE, rawBool: true } : undefined
}

/** A raw BOOL's initial byte: the BOOL's 0 or 1. */
export const rawBoolInit = (init: unknown): bigint => (init === true ? 1n : 0n)

/** Whether `place` names a raw BOOL whole (`IrSlot.rawBool` — a variable, a field, a routine's in-out), or is what a byte
 *  view reads (`isByteView`). */
export function isRawBoolPlace(lw: Lowering, place: Place): boolean {
  const slot = place.root === "inout" && place.path.length === 0 ? lw.inoutSlots[place.slot] : slotOf(lw, place)
  return slot?.rawBool === true || viewedBy(lw, place) !== undefined
}

/** Whether the pointer (or reference) `pointer` is a BYTE VIEW: a POINTER TO BOOL that reads a byte (`bool-views.ts`) —
 *  its dereference is a BYTE (`deref.ts` `imageDeref`). */
export function isByteView(lw: Lowering, pointer: Place): boolean {
  const key = viewsBool(pointer.type) ? variableKey(lw, pointer) : undefined
  return key !== undefined && escapesOf(lw).byteViews.has(key)
}

/** The key of the byte view whose dereference `place` is (`imageDeref` guards it by the pointer) — undefined for any
 *  other place. */
function viewedBy(lw: Lowering, place: Place): string | undefined {
  if (place.root !== "image" || place.guard === undefined || place.path.length > 0 || !isByteView(lw, place.guard)) return undefined
  return variableKey(lw, place.guard)
}

/** A load of `place`, marked as a raw BOOL's byte when the place is one. */
export function rawBoolLoad(lw: Lowering, place: Place, load: IrExpr): IrExpr {
  return isRawBoolPlace(lw, place) ? marked(lw, load) : load
}

/**
 * A binary operator with a raw BOOL operand (`rawBinary`): AND / OR / XOR of the two bytes — a raw BOOL's byte itself —
 * and `=` / `<>` comparing them. Null when neither operand is raw; any other operator is refused `bool-byte`.
 */
export function rawBinary(lw: Lowering, op: IrBinOp, left: IrExpr, right: IrExpr, span: Span): IrExpr | undefined | null {
  if (!isRawBool(lw, left) && !isRawBool(lw, right)) return null
  const operands = { left: byteOf(lw, left), right: byteOf(lw, right) }
  if (op === "and" || op === "or" || op === "xor") return marked(lw, { kind: "binary", op, ...operands, type: BYTE, span })
  if (op === "eq" || op === "ne") return { kind: "binary", op, ...operands, type: BOOL, span }
  return refused(lw, `the operator ${op.toUpperCase()}`, span)
}

/** NOT of a raw BOOL: bit 0 inverted and the rest cleared, so a plain BOOL — `(x AND 1) = 0`. Null for any other operand. */
export function rawNot(lw: Lowering, operand: IrExpr, span: Span): IrExpr | null {
  if (!isRawBool(lw, operand)) return null
  const bit0: IrExpr = { kind: "binary", op: "and", left: byteOf(lw, operand), right: byteConst(1n, span), type: BYTE, span }
  return { kind: "binary", op: "eq", left: bit0, right: byteConst(0n, span), type: BOOL, span }
}

/** An IF's condition: a raw BOOL's byte is taken when it is not 0. Any other condition as it is. */
export function rawCondition(lw: Lowering, cond: IrExpr): IrExpr {
  if (!isRawBool(lw, cond)) return cond
  return { kind: "binary", op: "ne", left: byteOf(lw, cond), right: byteConst(0n, cond.span), type: BOOL, span: cond.span }
}

/** The conversions of a raw BOOL measured: BOOL_TO_INT and BOOL_TO_BYTE are its bit 0. */
const MEASURED_CONVERSIONS: ReadonlySet<string> = new Set(["INT", "BYTE"])

/** BOOL_TO_<integer> of a raw BOOL: its bit 0, into `to` — the two measured; null for any other operand. */
export function rawConversion(lw: Lowering, arg: IrExpr, to: Type, span: Span): IrExpr | undefined | null {
  if (!isRawBool(lw, arg)) return null
  if (!MEASURED_CONVERSIONS.has(elemOf(to)?.name ?? "")) return refused(lw, `BOOL_TO_${elemOf(to)?.name ?? "?"}`, span)
  const bit0: IrExpr = { kind: "binary", op: "and", left: byteOf(lw, arg), right: byteConst(1n, span), type: BYTE, span }
  return convert(bit0, to)
}

/** A pointer's (or reference's) target type; undefined for anything else. */
const targetOf = (t: Type): Type | undefined => (t.kind === "pointer" || t.kind === "reference" ? t.target : undefined)

const named = (t: Type): string => elemOf(t)?.name ?? ("name" in t && typeof t.name === "string" ? t.name : t.kind)

/**
 * `ADR(x)` of a variable the image holds, given to `pointer` (none when it is only compared) — what the escape pass learns,
 * or a refusal (`bool-byte`, true):
 *   - into a POINTER TO BOOL (`boolView`): x's BOOL's address, or a BYTE VIEW when what it reads is no plain BOOL's byte;
 *   - a BOOL into a pointer of another target type: a raw BOOL's seed — refused for one no key names (an element, a
 *     struct's field);
 *   - what HOLDS a BOOL — a struct, an instance, an array — into a pointer that VIEWS it as laid out (its own type, or an
 *     element's: `ADR(arr)` into a POINTER TO the element) stores a BOOL as a BOOL: noted, so a copy into another type is
 *     refused; into any other pointer, and anything into a pointer to what holds a BOOL that views it otherwise, refused —
 *     its BOOL's byte would be another type's.
 */
export function refusedBoolAddress(lw: Lowering, pointer: Holder | undefined, place: Place, span: Span): boolean {
  const target = pointer === undefined ? undefined : targetOf(pointer.type)
  // a pointer's or a reference's own place (`r REF= other.ref`) holds an address, no BOOL's byte: the pointer rules decide
  if (pointer === undefined || target === undefined || targetOf(place.type) !== undefined) return false
  if (isPlainBool(target)) return boolView(lw, pointer, place, span)
  if (isRawBoolPlace(lw, place) || isPlainBool(place.type)) {
    const key = variableKey(lw, place)
    if (key === undefined) return refused(lw, "the address of an element or a struct's field, given to a pointer of another type,", span) === undefined
    noteBoolSeed(lw, key)
    return false
  }
  if (sameView(target, place.type)) {
    if (holdsBool(lw, place.type)) noteBoolAddress(lw, pointer, null)
    return false
  }
  if (!holdsBool(lw, place.type) && !holdsBool(lw, target)) return false
  return refused(lw, `the address of a ${named(place.type)}, given to a POINTER TO ${named(target)} — one of them holds a BOOL —`, span) === undefined
}

/**
 * `ADR(x)` given to the POINTER TO BOOL `pointer`: a plain BOOL's own byte (or a struct's or array's every byte a plain
 * BOOL's, as `SafetyPLC_WordsToUDT` walks one) reads as the BOOL — its address noted (`null`: one no key names), so a copy
 * into another type makes it raw or is refused; anything else makes the pointer a BYTE VIEW (`bool_pointer_over_bytes`).
 * Refused, true: a byte view no key names, whose dereference no later lowering could tell apart.
 */
function boolView(lw: Lowering, pointer: Holder, place: Place, span: Span): boolean {
  const raw = isRawBoolPlace(lw, place)
  const bool = raw || isPlainBool(place.type)
  if (bool || holdsBool(lw, place.type)) noteBoolAddress(lw, pointer, bool ? (variableKey(lw, place) ?? null) : null)
  if (!raw && allPlainBools(lw, place.type)) return false
  if (pointer.key === undefined) return refused(lw, `the address of a ${named(place.type)}, given to a POINTER TO BOOL no variable names,`, span) === undefined
  noteByteView(lw, pointer.key)
  return false
}

/**
 * A pointer copied into another, `to := from` (the escape pass records the copy): across two target types a POINTER TO BOOL
 * copied INTO is a byte view and the BOOLs one copied FROM holds are raw (`bool-views.ts`). Refused, true, where no key can
 * follow the byte: into a byte view no variable names; out of a POINTER TO BOOL no variable names, or holding a BOOL no key
 * names, into another type; and across two types either of which holds a BOOL in a struct or an array.
 */
export function refusedBoolCopy(lw: Lowering, to: Holder, from: Holder, span: Span): boolean {
  const [t, f] = [targetOf(to.type), targetOf(from.type)]
  if (t === undefined || f === undefined) return false
  const viewFrom = from.key !== undefined && escapesOf(lw).byteViews.has(from.key)
  const into = (why: string): boolean => refused(lw, `${from.name || "a pointer"} copied into ${to.name || "a pointer"} — ${why} —`, span) === undefined
  if (sameStorage(t, f)) return isPlainBool(t) && to.key === undefined && viewFrom && into("a POINTER TO BOOL no variable names, reading a byte")
  if (isPlainBool(t)) return to.key === undefined && into("a POINTER TO BOOL no variable names, given another type's address")
  if (isPlainBool(f)) return (from.key === undefined || escapesOf(lw).unkeyedBools.has(from.key)) && into("the address of a BOOL no variable names")
  return (holdsBool(lw, t) || holdsBool(lw, f)) && into("one of the two types holds a BOOL")
}

/**
 * A place lent to a BOOL VAR_IN_OUT: the in-out reads and writes the place's own byte (`bool_byte_flow_inout`: a FUNCTION's
 * `x = TRUE` is FALSE for a 2), so the two are one — a flow both ways, under the in-out's key (`paramKey`, a FUNCTION's or
 * METHOD's). Refused, true: a BOOL held as its byte lent to an FB's VAR_IN_OUT (`paramKey` none — unmeasured), and a place
 * no key names whose byte the in-out's differs from.
 */
export function refusedBoolLent(lw: Lowering, paramKey: string | undefined, param: IrSlot, binding: IrBinding, span: Span): boolean {
  if ("kind" in binding || (!isPlainBool(param.type) && param.rawBool !== true)) return false
  const raw = isRawBoolPlace(lw, binding)
  if (!raw && !isPlainBool(binding.type)) return false
  const key = variableKey(lw, binding)
  if (paramKey === undefined) return raw && refused(lw, `a BOOL lent to the FB's VAR_IN_OUT ${param.name}`, span) === undefined
  if (key !== undefined) {
    noteBoolFlow(lw, paramKey, [key])
    noteBoolFlow(lw, key, [paramKey])
  }
  return raw !== (param.rawBool === true) && refused(lw, `a BOOL lent to the VAR_IN_OUT ${param.name}`, span) === undefined
}

/** Whether every byte of a value of `t` is a plain BOOL's — a BOOL, an array or a struct of them — none held as its byte. */
function allPlainBools(lw: Lowering, t: Type): boolean {
  if (t.kind === "array") return allPlainBools(lw, t.element)
  const fields = t.kind === "struct" ? lw.layouts.get(t.name.toUpperCase())?.fields : undefined
  if (t.kind === "struct") return fields !== undefined && fields.every((f) => f.rawBool !== true && allPlainBools(lw, f.type))
  return isPlainBool(t)
}

/** Whether a pointer of `target` views a value of `t` as it is laid out: `t` itself, or the element of an array it is. */
function sameView(target: Type, t: Type | undefined): boolean {
  for (let at = t; at !== undefined; at = at.kind === "array" ? at.element : undefined) if (sameStorage(target, at)) return true
  return false
}

/** Whether a value of `t` holds a BOOL — itself, a field of a struct or an instance, an element, at any depth (a BIT does
 *  not: its byte is its neighbours'). */
function holdsBool(lw: Lowering, t: Type, seen = new Set<string>()): boolean {
  if (isPlainBool(t)) return true
  if (t.kind === "array") return holdsBool(lw, t.element, seen)
  if (t.kind !== "struct" && t.kind !== "function_block") return false
  const name = t.name.toUpperCase()
  if (seen.has(name)) return false
  seen.add(name)
  return (lw.layouts.get(name)?.fields ?? []).some((f) => f.rawBool === true || holdsBool(lw, f.type, seen))
}

/**
 * A BOOL value stored into a variable — an assignment, an input, an output read back: the flow recorded for the escape pass
 * (the variable `key` names takes the byte of every raw BOOL the value carries), and the value as the destination holds
 * it — a raw destination its byte, any other `convert`ed. A raw value into a destination that is no raw BOOL is left
 * for `refuseUnmeasuredRawBools` to name.
 */
export function storedBool(lw: Lowering, key: string | undefined, target: Type, rawTarget: boolean, value: IrExpr): IrExpr {
  if (key !== undefined && (rawTarget || isPlainBool(target))) noteBoolFlow(lw, key, carried(lw, value))
  return rawTarget ? byteOf(lw, value) : convert(value, target)
}

/** The variables whose byte a BOOL value carries: a load's — a byte view's dereference by its `viewKey` — and both
 *  operands' of AND / OR / XOR — what `c := b` and `c := b OR f` keep of b (`bool_byte_ops`); none through NOT or a
 *  comparison, which answer 0 or 1. */
function carried(lw: Lowering, e: IrExpr): string[] {
  if (e.kind === "load") {
    const view = viewedBy(lw, e.place)
    if (view !== undefined) return [viewKey(view)]
    const key = isPlainBool(e.type) || isRawBool(lw, e) ? variableKey(lw, e.place) : undefined
    return key === undefined ? [] : [key]
  }
  if (e.kind === "binary" && (e.op === "and" || e.op === "or" || e.op === "xor") && (isPlainBool(e.type) || isRawBool(lw, e)))
    return [...carried(lw, e.left), ...carried(lw, e.right)]
  if (e.kind === "convert" && isPlainBool(e.value.type)) return carried(lw, e.value)
  return []
}

/**
 * THE GUARD: a raw BOOL's byte that no measured operator took — it stands in an IR `bodies` holds where its meaning is
 * unmeasured (a WHILE condition, an order, SEL, a conversion but BOOL_TO_INT / BYTE, a STRING, an element or a FUNCTION's
 * result it is stored into) — refused `bool-byte`, once per lowering.
 */
export function refuseUnmeasuredRawBools(lw: Lowering, bodies: readonly (readonly IrStmt[])[]): void {
  const { raw, taken } = rawState(lw)
  let found: IrExpr | undefined
  for (const body of bodies) forEachExpr(body, (e) => void (found ??= raw.has(e) && !taken.has(e) ? e : undefined))
  if (found !== undefined) refused(lw, "a use", found.span)
}

const byteConst = (value: bigint, span: Span): IrExpr => ({ kind: "const", value, type: BYTE, span })

function refused(lw: Lowering, what: string, span: Span): undefined {
  return lw.bail("bool-byte", `${what} of a BOOL held as its byte (its address reaches a pointer of another type) — unmeasured on a byte other than 0 or 1`, span)
}
