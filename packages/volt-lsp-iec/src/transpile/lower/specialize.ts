/**
 * A VAR_IN_OUT bound to a place INSIDE the instance its routine runs on — `Mixed(counter, 3)` and `Two(a := n, b := n)`
 * on THIS, `SUPER^(a := n, b := n)`, `THIS^.inner.Bump(v := inner.x)` (conformance `callshape_own_field_*`,
 * `callshape_super_own_field_twice`, `callshape_inout_sub_instance_field`). CODESYS binds by reference, so the callee's
 * writes through the in-out and its reads of the same field BY NAME are one storage: 7 + 3 read back as 10, `a := 5`
 * then `b := b + 1` as 6, `v := v + 1` beside `x := x + 10` as 11.
 *
 * A `&mut` cannot say that — it would be a second `&mut` into the instance the call already holds (rustc E0499) — and the
 * copy written back that `bindInOut` uses for the narrow case gets it WRONG the moment the callee reaches the field
 * another way, which is exactly what these four do. So the parameter is not a reference here: it is a PATH from the
 * instance, known at the call. The routine is specialized on it — one copy per binding, its in-out places rewritten to
 * that path — and the parameter disappears. Exact by construction (one storage, named one way) and borrow-free: every
 * access goes through the `&mut self` the routine already has.
 *
 * Narrow on purpose. The routine must CALL nothing: a nested call would be handed the substituted place beside the same
 * `self`, which is E0499 again. The path must be static — fields and constant indices, no bit, no dereference — so the
 * substitution is one rewrite, not a runtime choice. Anything else stays `call-inout-alias`.
 */
import type { Span } from "../../syntax/index.js"
import type { Access, IrBinding, IrRoutine, IrSlot, Place } from "../ir/index.js"
import type { Lowering } from "./lowering.js"

/** A binding that is not lent but substituted: `place` is the target in the CALLEE's terms (its layout's field, then the
 *  rest of the path). It never reaches the IR — `specializeRoutine` consumes it and the parameter is gone. */
export interface InFrame {
  kind: "inframe"
  place: Place
  span: Span
}

export const isInFrame = (b: IrBinding | InFrame | undefined): b is InFrame => b !== undefined && "kind" in b && b.kind === "inframe"

const fieldStep = (name: string): Access => ({ kind: "field", name })

const sameStep = (a: Access, b: Access): boolean =>
  a.kind === "field" && b.kind === "field"
    ? a.name.toUpperCase() === b.name.toUpperCase()
    : a.kind === "index" && b.kind === "index" && a.index.kind === "const" && b.index.kind === "const" && a.index.value === b.index.value

/**
 * The target as the CALLEE names it, when it lies inside the instance the callee runs on — else undefined. Both places
 * are read in the CALLER's frame, whose slot indices are its layout's field indices, so the path is compared as field
 * names and constant indices and re-rooted at the callee's own layout.
 */
export function inFramePlace(lw: Lowering, instance: Place | undefined, target: Place, calleeFb: string | undefined): Place | undefined {
  if (instance === undefined || calleeFb === undefined) return undefined
  if (target.root !== undefined || target.guard !== undefined || instance.guard !== undefined) return undefined
  if (instance.root !== undefined && instance.root !== "this") return undefined
  const named = (p: Place): Access[] | undefined => {
    const slot = lw.slots[p.slot]
    if (p.root === "this") return [...p.path]
    return slot === undefined ? undefined : [fieldStep(slot.name), ...p.path]
  }
  const from = named(instance)
  const to = named(target)
  if (from === undefined || to === undefined || from.length >= to.length) return undefined
  if (!from.every((step, i) => sameStep(step, to[i]!))) return undefined
  const rest = to.slice(from.length)
  const head = rest[0]!
  if (head.kind !== "field") return undefined
  if (rest.some((s) => s.kind === "bit" || (s.kind === "index" && s.index.kind !== "const"))) return undefined
  const fields = lw.layouts.get(calleeFb.toUpperCase())?.fields
  const slot = fields?.findIndex((f) => f.name.toUpperCase() === head.name.toUpperCase()) ?? -1
  if (fields === undefined || slot < 0) return undefined
  return { slot, path: rest.slice(1), type: target.type, span: target.span }
}

/** A body that calls nothing — no METHOD, ACTION, FUNCTION, FB body or interface dispatch. */
export function callsNothing(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(callsNothing)
  if (node === null || typeof node !== "object") return true
  const kind = (node as { kind?: string }).kind
  if (kind === "invoke" || kind === "dispatch" || kind === "call") return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "span" || key === "of" || callsNothing(child))
}

const isPlace = (n: object): n is Place => typeof (n as { slot?: unknown }).slot === "number" && Array.isArray((n as { path?: unknown }).path)

/** Rewrite every Place in an IR subtree, innermost first (a path's indices and a guard are mapped before their place). */
function mapPlaces<T>(node: T, f: (p: Place) => Place): T {
  if (Array.isArray(node)) return node.map((child) => mapPlaces(child, f)) as unknown as T
  if (node === null || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node)) out[key] = key === "type" || key === "span" || key === "of" ? child : mapPlaces(child, f)
  return (isPlace(node) ? f(out as unknown as Place) : out) as unknown as T
}

/** A specialized routine's suffix — the parameter and the path it stands for, so two call sites binding the same place
 *  share one copy and two binding different places get two. */
const suffixOf = (slot: IrSlot, place: Place): string =>
  `${slot.name}_${String(place.slot)}${place.path.map((s) => (s.kind === "field" ? `_${s.name}` : s.kind === "index" && s.index.kind === "const" ? `_${String(s.index.value)}` : "_?")).join("")}`

/**
 * Specialize `routine` on every in-frame binding among `bindings`, registering the copy under its own key. Returns the
 * routine to invoke and the bindings that are still lent, or undefined when nothing is in-frame.
 */
export function specializeRoutine(
  lw: Lowering,
  routine: IrRoutine,
  bindings: readonly (IrBinding | InFrame | undefined)[],
): { routine: IrRoutine; inouts: (IrBinding | undefined)[] } | undefined {
  const substituted = new Map<number, Place>()
  for (const [i, b] of bindings.entries()) if (isInFrame(b)) substituted.set(i, b.place)
  if (substituted.size === 0) return undefined
  const suffix = [...substituted].map(([i, place]) => suffixOf(routine.inouts[i]!, place)).join("__")
  const key = `${routine.key}#${suffix.toUpperCase()}`
  const kept = routine.inouts.map((_, i) => i).filter((i) => !substituted.has(i))
  const inouts = kept.map((i) => bindings[i] as IrBinding | undefined)
  const cached = lw.routines.get(key)
  if (cached?.state === "lowered") return { routine: cached.routine, inouts }
  const index = new Map(kept.map((old, now) => [old, now]))
  const rewrite = (p: Place): Place => {
    if (p.root !== "inout") return p
    const into = substituted.get(p.slot)
    if (into === undefined) return { ...p, slot: index.get(p.slot) ?? p.slot }
    return { slot: into.slot, path: [...into.path, ...p.path], type: p.type, span: p.span, ...(p.guard === undefined ? {} : { guard: p.guard }) }
  }
  const special: IrRoutine = {
    ...routine,
    name: `${routine.name}__${suffix}`,
    key,
    inouts: kept.map((i) => routine.inouts[i]!),
    body: mapPlaces(routine.body, rewrite),
  }
  lw.routines.set(key, { state: "lowered", routine: special })
  return { routine: special, inouts }
}
