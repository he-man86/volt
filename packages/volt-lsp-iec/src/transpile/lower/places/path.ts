/**
 * Paths through places: the type a place's root holds, a layout's field (`fieldOf`, over the IR's one field lookup
 * `fieldIn`) and the one walk of the types along a path (`typeAlong`; transpile-restructure 1.7.10).
 */

import { GLOBAL_CONTEXT } from "../core/keys.js"
import type { Lowering } from "../core/lowering.js"
import { type Access, type IrSlot, type IrValue, layoutField, type Place } from "../../ir/index.js"
import { elementOf, peelArray, type Type } from "../../../frontend/types/index.js"
import type { PointerTarget } from "../pointers/state.js"
import { interfaceFrame } from "../interfaces/state.js"

/** THE TYPE A PLACE'S ROOT HOLDS — where a walk along its path starts: its slot's, the instance the body runs on for
 *  `this`, the instance a caller lends for `lent` (`interfaceFrame` `lends`); none for an `image` place, whose root is an
 *  address. */
export function rootType(lw: Lowering, place: Place): Type | undefined {
  switch (place.root) {
    case undefined:
      return lw.slots[place.slot]?.type
    case "local":
      return lw.localSlots[place.slot]?.type
    case "inout":
      return lw.inoutSlots[place.slot]?.type
    case "global":
      return lw.shared.globals.slots[place.slot]?.type
    case "this":
      return lw.selfType
    case "lent":
      return interfaceFrame(lw).lends[place.slot]?.type
    case "image":
      return undefined
  }
}

/** A composite type's field by name, from its layout (`lw.layouts`) — the IR's one field lookup (`ir` `layoutField`). */
export function fieldOf(lw: Lowering, typeName: string, name: string): IrSlot | undefined {
  return layoutField(lw.layouts, typeName, name)
}

/**
 * How `typeAlong` steps. THE WALKS DIFFERED and each keeps its rule (phase 1 is output-neutral):
 * `fields` — which types a field step enters: `"struct"` only, or `"composite"` (a struct or an FB instance);
 * `element` — what an index step reaches: `"sized"` (`peelArray`, a sized array's element) or `"any"` (`elementOf`, an
 * `ARRAY[*]`'s too).
 */
interface PathRule {
  readonly fields: "struct" | "composite"
  readonly element: "sized" | "any"
}

/**
 * THE ONE PATH WALK: the types along `path`, from `root`. At each step `visit` is handed the step and the type it is
 * taken ON (undefined once the walk lost the type) and answers `undefined` to go on — to the field's declared type, the
 * array's element — or a value to stop with (`{ stopped }`). Walked to the end, the answer is the last type.
 *
 * Its sites (each with its rule): `throughInstance` (struct, sized), `insideInstance` (struct, sized),
 * `storage/bytes.byteOffset` (struct, sized), `storage/unions.unionOf` (composite, any), `interfaces/tags.interfaceKey`
 * (composite, sized).
 */
export function typeAlong<T>(
  lw: Lowering,
  root: Type | undefined,
  path: readonly Access[],
  rule: PathRule,
  visit: (step: Access, on: Type | undefined, at: number) => T | undefined,
): { stopped: T } | { type: Type | undefined } {
  let type = root
  for (const [at, step] of path.entries()) {
    const stopped = visit(step, type, at)
    if (stopped !== undefined) return { stopped }
    if (type === undefined) continue
    if (step.kind === "field")
      type = type.kind === "struct" || (rule.fields === "composite" && type.kind === "function_block") ? fieldOf(lw, type.name, step.name)?.type : undefined
    else if (step.kind === "index") type = rule.element === "sized" ? peelArray(type)?.element : elementOf(type)
    else type = undefined
  }
  return { type }
}

/** Two stored types that are the same: one elementary type (and capacity), one struct or FB, or arrays of the same bounds
 *  over the same element. */
export function sameStorage(a: Type, b: Type): boolean {
  if (a.kind === "elementary" && b.kind === "elementary") return a.elem.name === b.elem.name && a.length === b.length
  if ((a.kind === "struct" || a.kind === "function_block") && a.kind === b.kind) return a.name.toUpperCase() === b.name.toUpperCase()
  // a pointer is stored as its target's tag, so two pointers share storage when their targets do: `pp := ADR(p)` for a
  // `POINTER TO POINTER TO INT` over a `POINTER TO INT` (`decl_pointer_to_pointer_deref`, CODESYS runs it)
  if (a.kind === "pointer" && b.kind === "pointer") return sameStorage(a.target, b.target)
  const [x, y] = [peelArray(a), peelArray(b)]
  return x !== undefined && y !== undefined && x.lower === y.lower && x.length === y.length && sameStorage(x.element, y.element)
}

/**
 * How one STATIC step — a field, or an index that is a constant — is written into a key. The keys below are one identity,
 * written two ways (transpile-restructure 4.15, design.md §3.3 step 4f): `KEY_STEP` (a field upper-cased, an index `[v]`)
 * — `staticKey`, `placeKey`, `sameStep`, `sameTarget`; `SUFFIX_STEP` (`_name` in source casing, `_v`) stays its own,
 * because it is a RUST NAME (a specialized routine's, `suffixOf`), not a key. A third writing, `SAME_STEP`, compared an
 * index by value AND type (`1` against `1n`); measured over every fixture, the six corpora and `bun test src`, lowering
 * builds no constant index that is not a bigint — so it folded into `KEY_STEP`.
 */
interface StepWriting {
  field(name: string): string
  index(value: IrValue): string
}
const KEY_STEP: StepWriting = { field: (name) => name.toUpperCase(), index: (value) => `[${String(value)}]` }
const SUFFIX_STEP: StepWriting = { field: (name) => `_${name}`, index: (value) => `_${String(value)}` }

/** One step written for a key — undefined when it is not static (an index computed at run time, a bit). */
function stepKey(step: Access, writing: StepWriting): string | undefined {
  if (step.kind === "field") return writing.field(step.name)
  if (step.kind === "index" && step.index.kind === "const") return writing.index(step.index.value)
  return undefined
}

/** A path's steps written for a key — undefined when one of them is not static. */
function staticSteps(path: readonly Access[], writing: StepWriting): string[] | undefined {
  const steps: string[] = []
  for (const step of path) {
    const key = stepKey(step, writing)
    if (key === undefined) return undefined
    steps.push(key)
  }
  return steps
}

/**
 * THE ONE PLACE IDENTITY (transpile-restructure 1.7.11): which place this is, as a key two places share only when they
 * are the SAME one — its root, slot and static path — or undefined when that is not known while lowering (a runtime
 * index). A dereference's guard is not part of it: a pointer variable's one target is that variable, so `ADR(s)` and a
 * pointer given it agree (the STRING a cursor walks, `pointers/cursor.ts`).
 */
export function staticKey(place: Place): string | undefined {
  const steps = staticSteps(place.path, KEY_STEP)
  return steps === undefined ? undefined : `${place.root ?? "frame"}:${place.slot}:${steps.join(".")}`
}

/** A place whose path is fields and constant indices only — the same place read before a program is moved out and after. */
export const staticPath = (place: Place): boolean => staticSteps(place.path, KEY_STEP) !== undefined

/** Two steps that are the same static step: one field, or one constant index. */
export const sameStep = (a: Access, b: Access): boolean => {
  const key = stepKey(a, KEY_STEP)
  return key !== undefined && key === stepKey(b, KEY_STEP)
}

/** Two pointer targets naming the same variable (or the same array) — the one place identity (`staticKey`), through
 *  fields and constant indices only, and the same view of it (an element, a string's characters). */
export function sameTarget(a: PointerTarget, b: PointerTarget): boolean {
  if ((a.element === undefined) !== (b.element === undefined) || (a.chars === undefined) !== (b.chars === undefined)) return false
  const key = staticKey(a.base)
  return key !== undefined && key === staticKey(b.base)
}

/**
 * A specialized routine's suffix — the parameter and the path it stands for, so two call sites binding the same place
 * share one copy and two binding different places get two.
 *
 * `undefined` when a step cannot be NAMED, which today means an index that is not a constant. It used to render as
 * `"_?"`, and that is the whole defect: `arr[i]` and `arr[j]` produced the SAME suffix, so the same key, so the second
 * call site silently reused a body specialized for the first one's place. The suffix IS the identity here — a step it
 * cannot distinguish must stop the specialization, not blur into it.
 */
export const suffixOf = (slot: IrSlot, place: Place): string | undefined => {
  const steps = staticSteps(place.path, SUFFIX_STEP)
  return steps === undefined ? undefined : `${slot.name}_${String(place.slot)}${steps.join("")}`
}

/** A place's shape as a key, with the frame it indexes — undefined through a runtime index, a dereference, or a root no
 *  later call can name again (a routine's local, an in-out, a lent instance). */
export function placeKey(lw: Lowering, p: Place): string | undefined {
  if (p.guard !== undefined || (p.root !== undefined && p.root !== "global" && p.root !== "this")) return undefined
  const steps = staticSteps(p.path, KEY_STEP)
  if (steps === undefined) return undefined
  return `${p.root === "global" ? GLOBAL_CONTEXT : lw.frameContext}|${p.root ?? ""}:${p.root === "this" ? "" : p.slot}|${steps.join(".")}`
}

/** Whether a place key (`placeKey`) names a place of the globals. */
export const globalPlaceKey = (key: string): boolean => key.startsWith(`${GLOBAL_CONTEXT}|`)

/** Whether the path passes through an FB instance — a holder's field, a program's variable — which its own frame names too. */
function throughInstance(lw: Lowering, p: Place): boolean {
  const root: Type | undefined = p.root === "global" ? lw.shared.globals.slots[p.slot]?.type : lw.slots[p.slot]?.type
  const walked = typeAlong(lw, root, p.path, { fields: "struct", element: "sized" }, (step, on) =>
    on === undefined || on.kind === "function_block" || step.kind === "bit" ? true : undefined,
  )
  return "stopped" in walked
}

export const instanceKey = (lw: Lowering, p: Place): string | undefined =>
  (p.root === undefined || p.root === "global") && !throughInstance(lw, p) ? placeKey(lw, p) : undefined

/**
 * A place that reads INSIDE a function block instance declared with a structured initializer, or stops ON it (a METHOD run
 * on it, the instance itself — design.md §3.4 step 5d) — at any depth, not only one held directly in the frame.
 * `holder : T_H; seen : INT := holder.inner.started` reaches an FB through a STRUCT field and slipped past a check
 * that only looked at the root slot's kind.
 */
export const insideInstance =
  (lw: Lowering) =>
  (place: Place): string | undefined => {
    if (place.root !== undefined) return undefined
    const slot = lw.slots[place.slot]
    if (slot === undefined || !(typeof slot.init === "object" && slot.init !== null && "fields" in slot.init)) return undefined
    // the instance's name: the slot's, then every field step taken before it (an index step adds nothing)
    const nameAt = (at: number) => [slot.name, ...place.path.slice(0, at).flatMap((s) => (s.kind === "field" ? [s.name] : []))].join(".")
    const walked = typeAlong(lw, slot.type, place.path, { fields: "struct", element: "sized" }, (access, on, at) => {
      if (on === undefined) return null
      if (on.kind === "function_block") return nameAt(at)
      // a BIT access reaches into an integer, never into an instance
      if (access.kind !== "index" && (access.kind !== "field" || on.kind !== "struct")) return null
      return undefined
    })
    if ("stopped" in walked) return walked.stopped ?? undefined
    // a place stopping ON the instance — a METHOD run on it, the instance copied — reads it as much as its field does
    // (design.md §3.4 step 5d: `holder.Get()` and `holder.started` alike); so does one stopping on a STRUCT or array that
    // holds one (gate 5d: `copy : T_H := holder` copied the instance's structured-initialized state)
    return holdsInstance(lw, walked.type) ? nameAt(place.path.length) : undefined
  }

/**
 * THE ONE WALK INTO A VALUE'S TYPE, AT ANY DEPTH (transpile-restructure 8.3 R6): whether `t` — itself, an array's element
 * (an `ARRAY[*]`'s too), a STRUCT's or an FB's field, at any depth — is answered true. `own(t)` is asked of every type
 * reached that is no array: true (it holds), false (it does not, and is not entered), undefined (a STRUCT or an FB is
 * entered, anything else does not hold). `field(f, owner)` is asked of each field entered, before its type is: true,
 * false (skipped), undefined (its type is asked). A composite reached again while asked answers false — a cycle, or one
 * already answered false. Its sites: `holdsInstance`, `pointers/raw-bool.ts` `holdsBool`, `statements/assign.ts`
 * `holdsOwnAddress` / `holdsEscaped`, `calls/last-binding.ts` `registerWholeCopy`. (`init/fb-init.ts`
 * `reachesFbInit` keeps its own: its answer is memoized across calls in the init step, per type and question.)
 */
export function holdsAtAnyDepth(
  lw: Lowering,
  t: Type,
  own: (t: Type) => boolean | undefined,
  field: (f: IrSlot, owner: string) => boolean | undefined = () => undefined,
  seen = new Set<string>(),
): boolean {
  const element = elementOf(t)
  if (element !== undefined) return holdsAtAnyDepth(lw, element, own, field, seen)
  const verdict = own(t)
  if (verdict !== undefined) return verdict
  if (t.kind !== "struct" && t.kind !== "function_block") return false
  const name = t.name.toUpperCase()
  if (seen.has(name)) return false
  seen.add(name)
  return (lw.layouts.get(name)?.fields ?? []).some((f) => field(f, name) ?? holdsAtAnyDepth(lw, f.type, own, field, seen))
}

/** Whether a value of `t` is or holds an FB instance — an element or a field, at any depth. */
export const holdsInstance = (lw: Lowering, t: Type | undefined): boolean =>
  t !== undefined && holdsAtAnyDepth(lw, t, (u) => (u.kind === "function_block" ? true : undefined))
