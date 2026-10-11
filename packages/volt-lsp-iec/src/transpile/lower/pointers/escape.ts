/**
 * THE ESCAPE PASS (model 3, design.md §3.3 step 4d): which variables a program STORES the address of, and which pointers
 * hold such addresses — decided over the WHOLE program before its bodies lower for real, because one body's `ADR(inst.x)`
 * puts every instance of that FB type in the image, for every body.
 *
 * The pass is a lowering of the program that only records (`lower-unit.ts` runs it, then lowers again with its answer):
 * place resolution — sections, scopes, references, unions — is lowering's, and a second, syntactic copy of it would be a
 * second home for every one of those rules. Each address STORE (`storePointer`, `bindReference`, an FB's pointer input)
 * records its target's escape key and its pointer's key; a copy `q := p` records that the two hold one kind of value.
 *
 * WHAT ESCAPES — an image TYPE (`imageType`: an elementary type with bytes, an array or a measured struct of them):
 *   - a field of an FB instance: the FB TYPE escapes (`TYPE:<name>`), one body serving every instance;
 *   - a variable of the POU's own frame or a GVL: that variable alone (`POU:<pou>.<name>`, `GLOBAL.<name>`) — where a
 *     program places its variables is not measured (4.1), so each is a region of its own.
 * Anything else a pointer is given — a routine's local, a VAR_IN_OUT's target, an ANY's `pValue`, a STRING's characters,
 * an FB instance (a handle), another pointer — keeps form 1's TAG (`state.ts`), and its pointer is TAGGED: a pointer holds
 * addresses or tags, never both (`tagged` is closed over copies, both ways).
 */
import type { Place } from "../../ir/index.js"
import { elementarySize } from "../../semantics/index.js"
import type { Lowering } from "../core/lowering.js"
import type { Shared } from "../core/shared.js"
import { sharedState } from "../core/shared.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { fieldBytes } from "../storage/bytes.js"
import { unionsOf } from "../storage/unions.js"
import { storageOf } from "../storage/layout.js"
import { pointerKey } from "./state.js"
import { boolBytes, viewsBool } from "./bool-views.js"

/** One pass's answer: the FB types and the variables the image holds, the pointers that hold tags, the ANY inputs
 *  whose `pValue` a body stores into a pointer that holds addresses (by their holder key, `any.anyHolder`), and the BOOL
 *  bytes (`raw-bool.ts`): the BOOLs held as their byte (by `variableKey`), the POINTERs TO BOOL that read a byte (whose
 *  `viewKey` is among the raw BOOLs too) and the pointers that hold the address of a BOOL no key names. */
export interface Escapes {
  readonly types: ReadonlySet<string>
  readonly variables: ReadonlySet<string>
  readonly tagged: ReadonlySet<string>
  readonly anyAddresses: ReadonlySet<string>
  readonly rawBools: ReadonlySet<string>
  readonly byteViews: ReadonlySet<string>
  readonly unkeyedBools: ReadonlySet<string>
}

const NONE: Escapes = {
  types: new Set(),
  variables: new Set(),
  tagged: new Set(),
  anyAddresses: new Set(),
  rawBools: new Set(),
  byteViews: new Set(),
  unkeyedBools: new Set(),
}

/** What one lowering saw: each address store (its pointer's key, its target's escape key — none for a tag), each copy,
 *  each ANY input whose `pValue` was stored into a pointer that holds addresses; and for `raw-bool.ts`: each BOOL whose
 *  address a pointer of another type was given, each BOOL store with the BOOLs whose byte its value carries, each BOOL's
 *  address a POINTER TO BOOL was given (`null`: a BOOL no key names — an element, a struct's field), each POINTER TO
 *  BOOL given the address of what is no plain BOOL's byte, and whether each pointer's target is a plain BOOL. */
interface Seen {
  readonly stores: { pointer: string | undefined; target: string | undefined }[]
  readonly copies: [string, string][]
  readonly anyAddresses: Set<string>
  readonly boolSeeds: Set<string>
  readonly boolFlows: [string, readonly string[]][]
  readonly boolAddresses: [string, string | null][]
  readonly byteViews: Set<string>
  readonly boolPointers: Map<string, boolean>
}
const seenOf = sharedState<Seen>(() => ({
  stores: [],
  copies: [],
  anyAddresses: new Set(),
  boolSeeds: new Set(),
  boolFlows: [],
  boolAddresses: [],
  byteViews: new Set(),
  boolPointers: new Map(),
}))


/** The answer a lowering runs on — the previous pass's (`lower-unit.ts`), or none on the first. */
const given = new WeakMap<Shared, Escapes>()

export function runOnEscapes(shared: Shared, escapes: Escapes): void {
  given.set(shared, escapes)
}

export function escapesOf(lw: Lowering): Escapes {
  return given.get(lw.shared) ?? NONE
}

/** What a lowering saw, as the answer the next one runs on. */
export function escapesSeen(shared: Shared): Escapes {
  const seen = seenOf({ shared })
  const tagged = new Set(seen.stores.flatMap((s) => (s.target === undefined && s.pointer !== undefined ? [s.pointer] : [])))
  // a copy makes its two pointers one kind: closed both ways, to a fixed point
  for (let grew = true; grew; ) {
    grew = false
    for (const [a, b] of seen.copies)
      if (tagged.has(a) !== tagged.has(b)) {
        tagged.add(a)
        tagged.add(b)
        grew = true
      }
  }
  const targets = seen.stores.flatMap((s) => (s.target !== undefined && (s.pointer === undefined || !tagged.has(s.pointer)) ? [s.target] : []))
  return {
    types: families(shared, new Set(targets.flatMap((t) => (t.startsWith("TYPE:") ? [t.slice(5)] : [])))),
    variables: new Set(targets.filter((t) => !t.startsWith("TYPE:"))),
    tagged,
    anyAddresses: seen.anyAddresses,
    ...boolBytes(seen),
  }
}

/** Two escape answers as one. */
export const joined = (a: Escapes, b: Escapes): Escapes => ({
  types: new Set([...a.types, ...b.types]),
  variables: new Set([...a.variables, ...b.variables]),
  tagged: new Set([...a.tagged, ...b.tagged]),
  anyAddresses: new Set([...a.anyAddresses, ...b.anyAddresses]),
  rawBools: new Set([...a.rawBools, ...b.rawBools]),
  byteViews: new Set([...a.byteViews, ...b.byteViews]),
  unkeyedBools: new Set([...a.unkeyedBools, ...b.unkeyedBools]),
})

/** Whether an answer holds nothing — a lowering that stored no address needs no second one. */
export const isEmpty = (e: Escapes): boolean =>
  e.types.size + e.variables.size + e.tagged.size + e.anyAddresses.size + e.rawBools.size + e.byteViews.size + e.unkeyedBools.size === 0

/**
 * The escaped FB types closed over EXTENDS, both ways: a base's body runs on a derived instance and a derived body reads
 * the base's fields, so one family keeps its fields in one place — the image for all of them, or for none.
 */
function families(shared: Shared, types: Set<string>): Set<string> {
  for (let grew = true; grew; ) {
    grew = false
    for (const [name, body] of shared.bodies) {
      const base = body.unit.kind === "function_block" ? body.unit.extends?.text.toUpperCase() : undefined
      if (base === undefined || types.has(name) === types.has(base)) continue
      types.add(name)
      types.add(base)
      grew = true
    }
  }
  return types
}

/** Whether `b` adds nothing to `a` — the passes have reached their fixed point. */
export function covers(a: Escapes, b: Escapes): boolean {
  const all = (x: ReadonlySet<string>, y: ReadonlySet<string>): boolean => [...y].every((k) => x.has(k))
  return (
    all(a.types, b.types) &&
    all(a.variables, b.variables) &&
    all(a.tagged, b.tagged) &&
    all(a.anyAddresses, b.anyAddresses) &&
    all(a.rawBools, b.rawBools) &&
    all(a.byteViews, b.byteViews) &&
    all(a.unkeyedBools, b.unkeyedBools)
  )
}

/**
 * A pointer something is stored into, as the escape pass names it: its type, its key (`variableKey`; undefined for one
 * kept nowhere a store can name) and how a message names it. A pointer VARIABLE is one (`holderOf`); so is a routine's
 * pointer INPUT a call hands an address to, named by the routine's own key for it.
 */
export interface Holder {
  readonly type: Type
  readonly key: string | undefined
  readonly name: string
}

export const holderOf = (lw: Lowering, pointer: Place, name: string): Holder => ({ type: pointer.type, key: variableKey(lw, pointer), name })

/** An address of `target` stored into the pointer `pointer` — the target's escape key, or none: a tag. An address
 *  compared, stored nowhere, has no pointer: its target is in the image all the same, so the two can be compared. */
export function noteStore(lw: Lowering, pointer: Holder | undefined, target: Place | undefined): void {
  seenOf(lw).stores.push({ pointer: pointer?.key, target: target === undefined ? undefined : escapeKey(lw, target) })
  if (pointer !== undefined) notePointer(lw, pointer)
}

/** Whether a pointer a key names views a plain BOOL, for `boolBytes`. */
function notePointer(lw: Lowering, pointer: Holder): void {
  if (pointer.key !== undefined) seenOf(lw).boolPointers.set(pointer.key, viewsBool(pointer.type))
}

/** `p := v.pValue` into a pointer that holds addresses: the ANY input's holder (`any.anyHolder`) asks its call sites for
 *  their argument's address from the next lowering on. */
export function noteAnyAddress(lw: Lowering, holder: Holder): void {
  if (holder.key !== undefined) seenOf(lw).anyAddresses.add(holder.key)
}

/** A BOOL whose address a pointer of another target type was given (`raw-bool.ts`): a raw BOOL. */
export function noteBoolSeed(lw: Lowering, key: string): void {
  seenOf(lw).boolSeeds.add(key)
}

/** A BOOL's address — `null`: one no key names — given to the POINTER TO BOOL `pointer` (`raw-bool.ts`). */
export function noteBoolAddress(lw: Lowering, pointer: Holder, bool: string | null): void {
  notePointer(lw, pointer)
  if (pointer.key !== undefined) seenOf(lw).boolAddresses.push([pointer.key, bool])
}

/** A POINTER TO BOOL given the address of what is no plain BOOL's byte: a byte view (`raw-bool.ts`). */
export function noteByteView(lw: Lowering, pointer: string): void {
  seenOf(lw).byteViews.add(pointer)
}

/** A BOOL store: the variable `to` takes the byte of every BOOL in `from` (`raw-bool.ts`). */
export function noteBoolFlow(lw: Lowering, to: string, from: readonly string[]): void {
  if (from.length > 0) seenOf(lw).boolFlows.push([to, from])
}

/** `to := from`, two pointers: one kind of value. */
export function noteCopy(lw: Lowering, to: Holder, from: Holder): void {
  if (to.key !== undefined && from.key !== undefined) seenOf(lw).copies.push([to.key, from.key])
  notePointer(lw, to)
  notePointer(lw, from)
}

/** A variable's key: its own frame's (`pointerKey`), or — for a field reached from outside its instance — the key its own
 *  FB's bodies give it (`FB:<type>.<field>`). Undefined for one kept nowhere a store can name (an element, a field of a
 *  struct). A pointer's for the escape pass, a BOOL's for `raw-bool.ts`. */
export function variableKey(lw: Lowering, pointer: Place): string | undefined {
  const own = pointerKey(lw, pointer)
  if (own !== undefined) return own
  const last = pointer.path.at(-1)
  if (last?.kind !== "field" || pointer.guard !== undefined) return undefined
  const holder = typeOfPrefix(lw, pointer, pointer.path.length - 1)
  return holder?.kind === "function_block" ? `FB:${holder.name.toUpperCase()}.${last.name.toUpperCase()}` : undefined
}

/** Whether a pointer or reference holds ADDRESSES into the image: its target is an image type, and no store made it hold
 *  a tag. Form 2's borrow and a string cursor are asked before this, by their own names. */
export function holdsAddresses(lw: Lowering, pointer: Place): boolean {
  return holderHoldsAddresses(lw, { type: pointer.type, key: variableKey(lw, pointer), name: "" }, pointer.span)
}

/** `holdsAddresses`, asked of a holder. */
export function holderHoldsAddresses(lw: Lowering, holder: Holder, span: Place["span"]): boolean {
  if (holder.type.kind !== "pointer" && holder.type.kind !== "reference") return false
  if (!imageTarget(lw, holder.type.target, span)) return false
  return holder.key === undefined || !escapesOf(lw).tagged.has(holder.key)
}

/** Whether a pointer's target type is an image type — asked WITHOUT laying out a struct or FB: a pointer to the type
 *  being laid out (`THIS`, a list's `next`) is asked while its layout is built, and building it again is a cycle
 *  (`layout-recursive`). An FB, an interface, a string, an enum are no image type in any case. */
function imageTarget(lw: Lowering, t: Type, span: Place["span"]): boolean {
  const array = t.kind === "array" ? peelArray(t) : undefined
  if (t.kind === "array") return array !== undefined && imageTarget(lw, array.element, span)
  if (t.kind === "struct") return lw.layouts.has(t.name.toUpperCase()) && imageType(lw, storageOf(lw, t, span))
  return t.kind === "elementary" && elementarySize(t) !== undefined
}

/**
 * THE IMAGE TYPES: an elementary type with bytes, an array of image types, a struct whose every field is one at a measured
 * offset (no union, no BIT, no string). A struct found to be one has its layout marked with its offsets and size
 * (`IrSlot.image`, `IrLayout.size`), which is what `semantics/memory.ts` folds a field step by.
 */
export function imageType(lw: Lowering, t: Type): boolean {
  if (elementarySize(t) !== undefined) return true
  const array = peelArray(t)
  if (array !== undefined) return imageType(lw, array.element)
  if (t.kind !== "struct") return false
  const key = t.name.toUpperCase()
  const layout = lw.layouts.get(key)
  if (layout === undefined || unionsOf(lw).has(key)) return false
  if (layout.size !== undefined) return true
  const bytes = fieldBytes(lw, t)
  if (bytes?.offsets === undefined || !layout.fields.every((f) => bytes.offsets!.has(f.name.toUpperCase()) && imageType(lw, f.type))) return false
  lw.layouts.set(key, { ...layout, size: Number(bytes.size), fields: layout.fields.map((f) => ({ ...f, image: Number(bytes.offsets!.get(f.name.toUpperCase())!) })) })
  return true
}

/** The sections an FB instance stores its fields in — a VAR_TEMP or a lowering temp is no part of the instance. */
const INSTANCE_FIELD: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT"])

/**
 * Where an address of `target` lives, as an escape key — undefined when the image cannot hold it (it then stays a tag).
 * The innermost FB instance along the place holds it (`TYPE:<fb>`, the field right under that instance an image type in
 * an instance section); with none, the root variable of the POU's frame or a GVL does, when its type is an image type.
 */
export function escapeKey(lw: Lowering, target: Place): string | undefined {
  if (target.guard !== undefined || target.root === "image" || target.path.some((s) => s.kind === "bit") || !imageType(lw, target.type)) return undefined
  // an FB, METHOD or ACTION body's plain slot IS a field of its instance: the walk starts on that instance
  const ownFields = (target.root === undefined && lw.selfType?.kind === "function_block") || target.root === "this"
  const steps = target.root === undefined && ownFields ? [{ kind: "field" as const, name: lw.slots[target.slot]!.name }, ...target.path] : target.path
  let type: Type | undefined = ownFields ? lw.selfType : rootTypeOf(lw, target)
  let holder: string | undefined
  let throughInstance = ownFields
  for (const step of steps) {
    if (type === undefined) return undefined
    // the instance this body runs on: its fields are this frame's slots — its layout is not laid until they are
    const own = ownFields && type === lw.selfType ? lw.slots[lw.byName.get(step.kind === "field" ? step.name.toUpperCase() : "") ?? -1] : undefined
    const field =
      own ??
      (step.kind === "field" && (type.kind === "struct" || type.kind === "function_block")
        ? lw.layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())
        : undefined)
    // a field right under an instance: the image holds it when its section is the instance's and its type an image type
    if (field !== undefined && type.kind === "function_block") {
      throughInstance = true
      holder = INSTANCE_FIELD.has(field.section) && imageType(lw, field.type) ? type.name.toUpperCase() : undefined
    }
    type = step.kind === "field" ? field?.type : peelArray(type)?.element
  }
  if (holder !== undefined) return `TYPE:${holder}`
  return throughInstance ? undefined : rootVariableKey(lw, target)
}

/** The escape key of a variable of the POU's own frame or of a GVL, whose own type is an image type. */
function rootVariableKey(lw: Lowering, target: Place): string | undefined {
  if (target.root === "global") {
    const slot = lw.shared.globals.slots[target.slot]
    return slot !== undefined && slot.section !== "program" && imageType(lw, slot.type) ? `GLOBAL.${slot.name.toUpperCase()}` : undefined
  }
  if (target.root !== undefined || lw.routineMode || lw.frameContext !== `POU:${lw.shared.root.toUpperCase()}`) return undefined
  const slot = lw.slots[target.slot]
  return slot !== undefined && slot.section !== "temp" && imageType(lw, slot.type) ? `POU:${lw.shared.root.toUpperCase()}.${slot.name.toUpperCase()}` : undefined
}

/** The type a place's root slot holds. */
function rootTypeOf(lw: Lowering, p: Place): Type | undefined {
  switch (p.root) {
    case "local":
      return lw.localSlots[p.slot]?.type
    case "inout":
      return lw.inoutSlots[p.slot]?.type
    case "global":
      return lw.shared.globals.slots[p.slot]?.type
    case "lent":
      return p.path.length === 0 ? p.type : undefined
    default:
      return lw.slots[p.slot]?.type
  }
}

/** The type the first `n` steps of a place reach. */
function typeOfPrefix(lw: Lowering, p: Place, n: number): Type | undefined {
  let type = rootTypeOf(lw, p)
  for (const step of p.path.slice(0, n)) {
    if (type === undefined) return undefined
    type =
      step.kind === "field"
        ? type.kind === "struct" || type.kind === "function_block"
          ? lw.layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type
          : undefined
        : step.kind === "index"
          ? peelArray(type)?.element
          : undefined
  }
  return type
}
