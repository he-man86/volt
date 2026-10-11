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

import { type Access, fieldIndex, type IrBinding, type IrPou, type IrRoutine, type Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { Lowering } from "../core/lowering.js"
import { sameStep, suffixOf } from "../places/path.js"
import { isPlace, mapPlaces, someNode } from "../../ir/walk.js"
import { once } from "./routines.js"
import { ZERO_SPAN } from "../core/build.js"

/** A binding that is not lent but substituted: `place` is the target in the CALLEE's terms (its layout's field, then the
 *  rest of the path). It never reaches the IR — `specializeRoutine` consumes it and the parameter is gone. */
export interface InFrame {
  kind: "inframe"
  place: Place
  span: Span
}

export const isInFrame = (b: IrBinding | InFrame | undefined): b is InFrame => b !== undefined && "kind" in b && b.kind === "inframe"

const fieldStep = (name: string): Access => ({ kind: "field", name })

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
  const slot = fieldIndex(fields, head.name)
  if (fields === undefined || slot < 0) return undefined
  return { slot, path: rest.slice(1), type: target.type, span: target.span }
}

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
  const parts = [...substituted].map(([i, place]) => suffixOf(routine.inouts[i]!, place))
  // A place this cannot name is not specialized AT ALL — the caller lends it instead, which is always correct and
  // merely less direct. Naming it `_?` shared one body between two different places.
  if (parts.some((part) => part === undefined)) return undefined
  const suffix = parts.join("__")
  const key = `${routine.key}#${suffix.toUpperCase()}`
  const kept = routine.inouts.map((_, i) => i).filter((i) => !substituted.has(i))
  const inouts = kept.map((i) => bindings[i] as IrBinding | undefined)
  const index = new Map(kept.map((old, now) => [old, now]))
  const rewrite = (p: Place): Place => {
    if (p.root !== "inout") return p
    const into = substituted.get(p.slot)
    if (into === undefined) {
      // Every in-out that was NOT substituted is in `kept`, so `index` has it. `?? p.slot` silently kept the OLD
      // number against a list this call has already shortened, which would read a different parameter.
      const now = index.get(p.slot)
      if (now === undefined) throw new Error(`specialize: in-out slot ${p.slot} of ${routine.name} is neither substituted nor kept`)
      return { ...p, slot: now }
    }
    return { slot: into.slot, path: [...into.path, ...p.path], type: p.type, span: p.span, ...(p.guard === undefined ? {} : { guard: p.guard }) }
  }
  const special = once(lw, key, ZERO_SPAN, () => ({
    ...routine,
    name: `${routine.name}__${suffix}`,
    key,
    inouts: kept.map((i) => routine.inouts[i]!),
    body: routine.body.map((s) => mapPlaces(s, rewrite)),
  }), { quiet: true })
  if (special === undefined) throw new Error(`specialize: ${key} is cached as failed, which a specialization never is`)
  return { routine: special, inouts }
}

/**
 * THE POU WITHOUT THE GENERICS EVERY CALL REPLACED (lean 7.7.11): a routine some call specialized (a `<key>#…` beside
 * it) and no call invokes as itself is lowered once for the specializations to copy, and runs nowhere — `ptrparam_method`
 * printed its generic `read` beside `read_ptr_p_0` and `read_ptr_p_1`, a fn nothing calls. A routine no call reaches
 * that has NO specialization stays: it is the POU's own (a METHOD a caller outside it may name).
 */
export function withoutReplacedGenerics(pou: IrPou): IrPou {
  const invoked = new Set<string>()
  someNode([...pou.body, ...(pou.init ?? []), ...pou.layouts.flatMap((l) => l.body ?? []), ...pou.routines.flatMap((r) => r.body)], (n) => {
    if (!isPlace(n) && n.kind === "invoke") invoked.add(n.routine)
    return false
  })
  const replaced = (r: IrRoutine): boolean => !invoked.has(r.key) && pou.routines.some((s) => s.key.startsWith(`${r.key}#`))
  return pou.routines.some(replaced) ? { ...pou, routines: pou.routines.filter((r) => !replaced(r)) } : pou
}
