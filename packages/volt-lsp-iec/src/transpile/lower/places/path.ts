/**
 * Paths through places: the type a place's root holds.
 */

import type { Lowering } from "../lowering.js"
import type { Access, IrSlot, Place } from "../../ir/index.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import type { PointerTarget } from "../pointers/state.js"

/** The type a place's root holds — where a byte offset along its path starts. */
export function rootType(lw: Lowering, place: Place): Type | undefined {
  switch (place.root) {
    case "local":
      return lw.localSlots[place.slot]?.type
    case "inout":
      return lw.inoutSlots[place.slot]?.type
    case "global":
      return lw.shared.globals.slots[place.slot]?.type
    case "this":
      return lw.selfType
    default:
      return lw.slots[place.slot]?.type
  }
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

/** Two pointer targets naming the same variable (or the same array) — through fields and constant indices only. */
export function sameTarget(a: PointerTarget, b: PointerTarget): boolean {
  if (a.base.slot !== b.base.slot || a.base.root !== b.base.root || (a.element === undefined) !== (b.element === undefined)) return false
  if ((a.chars === undefined) !== (b.chars === undefined)) return false
  if (a.base.path.length !== b.base.path.length) return false
  return a.base.path.every((step, i) => {
    const other = b.base.path[i]!
    if (step.kind === "field") return other.kind === "field" && other.name.toUpperCase() === step.name.toUpperCase()
    if (step.kind === "index")
      return other.kind === "index" && step.index.kind === "const" && other.index.kind === "const" && step.index.value === other.index.value
    return false
  })
}

/** Which string a place is, as a key two arguments agree on only when they name the SAME one — or undefined when that
 *  is not known while lowering: an index computed at run time. A pointer variable's one target is that variable, so
 *  `ADR(s)` and a pointer given it agree. */
export function stringIdentity(place: Place): string | undefined {
  const path: string[] = []
  for (const a of place.path) {
    if (a.kind === "field") path.push(a.name.toUpperCase())
    else if (a.kind === "index" && a.index.kind === "const") path.push(`[${a.index.value}]`)
    else return undefined
  }
  return `${place.root ?? "frame"}:${place.slot}:${path.join(".")}`
}

/** A place whose path is fields and constant indices only — the same place read before a program is moved out and after. */
export const staticPath = (place: Place): boolean => place.path.every((s) => s.kind === "field" || (s.kind === "index" && s.index.kind === "const"))

export const sameStep = (a: Access, b: Access): boolean =>
  a.kind === "field" && b.kind === "field"
    ? a.name.toUpperCase() === b.name.toUpperCase()
    : a.kind === "index" && b.kind === "index" && a.index.kind === "const" && b.index.kind === "const" && a.index.value === b.index.value

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
  const steps: string[] = []
  for (const step of place.path) {
    if (step.kind === "field") steps.push(`_${step.name}`)
    else if (step.kind === "index" && step.index.kind === "const") steps.push(`_${String(step.index.value)}`)
    else return undefined
  }
  return `${slot.name}_${String(place.slot)}${steps.join("")}`
}

/** A place's shape as a key, with the frame it indexes — undefined through a runtime index, a dereference, or a root no
 *  later call can name again (a routine's local, an in-out, a lent instance). */
export function placeKey(lw: Lowering, p: Place): string | undefined {
  if (p.guard !== undefined || (p.root !== undefined && p.root !== "global" && p.root !== "this")) return undefined
  const steps: string[] = []
  for (const step of p.path) {
    if (step.kind === "field") steps.push(step.name.toUpperCase())
    else if (step.kind === "index" && step.index.kind === "const") steps.push(`[${String(step.index.value)}]`)
    else return undefined
  }
  return `${p.root === "global" ? "GLOBAL" : lw.frameContext}|${p.root ?? ""}:${p.root === "this" ? "" : p.slot}|${steps.join(".")}`
}

/** Whether the path passes through an FB instance — a holder's field, a program's variable — which its own frame names too. */
function throughInstance(lw: Lowering, p: Place): boolean {
  let t: Type | undefined = p.root === "global" ? lw.shared.globals.slots[p.slot]?.type : lw.slots[p.slot]?.type
  for (const step of p.path) {
    if (t === undefined || t.kind === "function_block") return true
    if (step.kind === "field") t = t.kind === "struct" ? lw.layouts.get(t.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type : undefined
    else if (step.kind === "index") t = peelArray(t)?.element
    else return true
  }
  return false
}

export const instanceKey = (lw: Lowering, p: Place): string | undefined =>
  (p.root === undefined || p.root === "global") && !throughInstance(lw, p) ? placeKey(lw, p) : undefined

/**
 * A place that reads INSIDE a function block instance declared with a structured initializer — at any depth, not only
 * one held directly in the frame.
 * `holder : T_H; seen : INT := holder.inner.started` reaches an FB through a STRUCT field and slipped past a check
 * that only looked at the root slot's kind.
 */
export const insideInstance =
  (lw: Lowering) =>
  (place: Place): string | undefined => {
    if (place.root !== undefined) return undefined
    const slot = lw.frame[place.slot]
    if (slot === undefined || !(typeof slot.init === "object" && slot.init !== null && "fields" in slot.init)) return undefined
    let type: Type | undefined = slot.type
    let name = slot.name
    for (const access of place.path) {
      if (type === undefined) return undefined
      if (type.kind === "function_block") return name
      if (access.kind === "index") {
        type = peelArray(type)?.element
        continue
      }
      // a BIT access reaches into an integer, never into an instance
      if (access.kind !== "field" || type.kind !== "struct") return undefined
      type = (lw.layouts.get(type.name.toUpperCase())?.fields ?? []).find(
        (f) => f.name.toUpperCase() === access.name.toUpperCase(),
      )?.type
      name = `${name}.${access.name}`
    }
    return undefined
  }
