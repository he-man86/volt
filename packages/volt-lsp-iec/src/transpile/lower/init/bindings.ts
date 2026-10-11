/**
 * ADDRESS BINDINGS AS INITIAL VALUES (transpile-restructure 7.8.8, design.md §3.3/§3.4 "Decision (step 7.8d)").
 *
 * `p : POINTER TO INT := ADR(x)` and `r : REFERENCE TO T REF= x` bind a pointer to storage of its own frame. What the
 * binding stores is an ADDRESS — the same whenever it is taken: a variable of the program's frame is at a fixed place in
 * the byte image, an instance's field at its region's `__base` plus the field's offset, and a pointer the image cannot hold
 * keeps a tag that names its target per TYPE. So the store is no statement of the init step: it is the slot's initial
 * value — `ref_: 0x1_0000_0000` in a program's `new()`, `FB { __base: B, p: B + 8, ..FB::new() }` at each static
 * instance, the tag in `FB::new()` — and an `init()` / `__init()` left empty goes, with its call chain.
 *
 * A BINDING (`bindingOf`) is a store of such an address into a whole pointer or reference slot of the frame. It reads
 * nothing, so it never starts the position rule's walk (`step.ts`, `fb-init.ts`): a constant declared after it stays a
 * constant whether or not the binding folds.
 *
 * THE PROOF that nothing touches the slot before its binding ran (`provenBindings`). Folding moves the binding ahead of
 * the whole init step, which changes what an init step statement BEFORE the store sees of the slot — and what it WRITES
 * there, which the binding then no longer overwrites. On the built sequence, in execution order (each `__init` part
 * entered where it is invoked), a binding is proven only when nothing before it reads or writes a variable of its name,
 * dereferences, or calls anything — each conservative: a name may be another frame's variable, a dereference may reach
 * the slot through a pointer, a call may do either. (Another instance's binding of the same field is no such write: a
 * binding stores its own frame's whole slot.) An unproven binding keeps its store, which is exact as it was. Measured
 * 2026-10-11: every one of the 25 bindings the conformance fixtures lower is proven.
 *
 * THE FOLD (`foldBindings`) runs on the POU once the image pass has rewritten it, where every address is a constant or a
 * region's `__base` plus an offset. A pointer's own slot is never in the image (`escape.ts` `imageType`: no pointer is an
 * image type), so the value it starts at is always the struct's field.
 */
import type { IrExpr, IrInit, IrLayout, IrPou, IrRoutine, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { childrenOf, initReadChildren, type IrNode, isPlace } from "../../ir/walk.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { BASE_FIELD, LoweringBug } from "../../semantics/index.js"
import type { Lowering } from "../core/lowering.js"
import { isInitPartKey } from "./instance-init.js"

/** A binding's statement: the whole slot stored, and the address it stores. */
type Binding = Extract<IrStmt, { kind: "assign" }>

/** Whether a place is a whole slot of the frame the statement runs in — no root, no path, no dereference. */
const wholeSlot = (p: Place): boolean => p.root === undefined && p.path.length === 0 && p.guard === undefined

/** Whether a place is storage of the frame at a path every backend resolves at compile time: its fields and constant
 *  indices, no dereference — or, once the image pass ran, an image place with no runtime index. */
function staticPlace(p: Place): boolean {
  if (p.guard !== undefined) return false
  if (p.root !== undefined && p.root !== "image") return false
  return p.path.every((s) => s.kind === "field" || (s.kind === "index" && s.index.kind === "const"))
}

/**
 * A BINDING: a store into a whole pointer or reference slot of the frame of a tag (a constant) or of the address of the
 * frame's own storage at a static path (`ADR(x)`, `ADR(rec.f)`, `REF= arr[2]`).
 */
export function bindingOf(s: IrStmt): Binding | undefined {
  if (s.kind !== "assign" || !wholeSlot(s.target)) return undefined
  if (s.target.type.kind !== "pointer" && s.target.type.kind !== "reference") return undefined
  return s.value.kind === "const" || (s.value.kind === "address" && staticPlace(s.value.place)) ? s : undefined
}

/** Whether statements are bindings only — none of them reads anything, so none starts the position rule's walk. */
export const bindsOnly = (statements: readonly IrStmt[]): boolean => statements.every((s) => bindingOf(s) !== undefined)

/** A binding's key: the frame it binds in (`""` the POU's own, else the FB type its `__init` part runs on) and its slot. */
const keyOf = (owner: string, slot: number): string => `${owner}#${slot}`

/**
 * The bindings of the built init step nothing reads before they run (see the file comment), by `keyOf`. `init` is the
 * init step as `initStep` built it, before the image pass. A binding an `__init` part holds is proven only where it is
 * proven at every instance that part runs on.
 */
export function provenBindings(lw: Lowering, init: readonly IrStmt[]): ReadonlySet<string> {
  const before = { opaque: false, names: new Set<string>() }
  const verdicts = new Map<string, boolean>()
  // what one node reads: every name it reaches (a frame's slot, a field along a path), any dereference, any call
  const note = (root: IrNode, fields: readonly IrSlot[], children: (n: IrNode) => IrNode[]): void => {
    const stack: IrNode[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (isPlace(n)) {
        if (n.guard !== undefined) before.opaque = true
        const named = n.root === undefined ? fields[n.slot]?.name : n.root === "global" ? lw.globals[n.slot]?.name : undefined
        if (named !== undefined) before.names.add(named.toUpperCase())
        for (const s of n.path) if (s.kind === "field") before.names.add(s.name.toUpperCase())
      } else if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call" || n.kind === "select") before.opaque = true
      stack.push(...children(n))
    }
  }
  const walk = (statements: readonly IrStmt[], owner: string, fields: readonly IrSlot[]): void => {
    for (const s of statements) {
      const part = s.kind === "eval" && s.value.kind === "invoke" && isInitPartKey(s.value.routine) ? lw.routines.get(s.value.routine) : undefined
      if (part?.state === "lowered" && part.routine.fb !== undefined) {
        const fb = part.routine.fb.toUpperCase()
        walk(part.routine.body, fb, lw.layouts.get(fb)?.fields ?? [])
        continue
      }
      const binding = bindingOf(s)
      if (binding !== undefined) {
        const key = keyOf(owner, binding.target.slot)
        const name = fields[binding.target.slot]?.name.toUpperCase()
        const clear = name !== undefined && !before.opaque && !before.names.has(name)
        verdicts.set(key, (verdicts.get(key) ?? true) && clear)
        note(binding.value, fields, initReadChildren)
        continue
      }
      // a store WRITES its target: a binding folded ahead of it would be overwritten by it, where the store before overwrote
      // nothing (an outer frame's `b.p := ADR(y)` ahead of `B.__INIT`'s `p := ADR(x)` ended at x, folded at y) — so its
      // names count as a read's do; and what locates it (an index, a dereference) is read
      if (s.kind === "assign") {
        note(s.value, fields, initReadChildren)
        note(s.target, fields, () => [])
        childrenOf(s.target).forEach((c) => note(c, fields, initReadChildren))
        continue
      }
      note(s, fields, initReadChildren)
    }
  }
  walk(init, "", lw.slots)
  return new Set([...verdicts].flatMap(([key, clear]) => (clear ? [key] : [])))
}

/** What a binding stores once the image pass ran: a constant, or the instance's `__base` plus a constant offset —
 *  undefined for any other address (a runtime one: the store stays). */
function boundValue(e: IrExpr): { offset: bigint; based: boolean } | undefined {
  if (e.kind === "const") return typeof e.value === "bigint" ? { offset: e.value, based: false } : undefined
  if (e.kind !== "address" || e.place.root !== "image" || e.place.path.length > 0 || e.place.at === undefined) return undefined
  const sum = (x: IrExpr): { offset: bigint; based: boolean } | undefined => {
    if (x.kind === "const") return typeof x.value === "bigint" ? { offset: x.value, based: false } : undefined
    if (x.kind === "load")
      return x.place.root === "this" && x.place.guard === undefined && x.place.path.length === 1 && x.place.path[0]!.kind === "field" && x.place.path[0]!.name === BASE_FIELD
        ? { offset: 0n, based: true }
        : undefined
    if (x.kind !== "binary" || x.op !== "add") return undefined
    const [l, r] = [sum(x.left), sum(x.right)]
    if (l === undefined || r === undefined || (l.based && r.based)) return undefined
    return { offset: l.offset + r.offset, based: l.based || r.based }
  }
  return sum(e.place.at)
}

/**
 * The POU with every proven binding folded into its slot's initial value (see the file comment) — the store gone, and an
 * `__init` part left with no statement gone with its invokes. `pou` is the POU after the image pass.
 */
export function foldBindings(pou: IrPou, proven: ReadonlySet<string>): IrPou {
  if (proven.size === 0) return pou
  const slots = [...pou.slots]
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  /** per FB type, the fields each instance holds at its `__base` plus an offset */
  const based = new Map<string, { field: string; offset: bigint }[]>()
  const folded = new Set<IrStmt>()
  // the POU's own frame: its bindings stand in the init step itself
  for (const s of pou.init ?? []) {
    const b = bindingOf(s)
    const value = b !== undefined && proven.has(keyOf("", b.target.slot)) ? boundValue(b.value) : undefined
    if (value === undefined || value.based) continue
    slots[b!.target.slot] = { ...slots[b!.target.slot]!, init: value.offset }
    folded.add(s)
  }
  // an FB's: in the `__init` parts that run on its instances
  const routines: IrRoutine[] = []
  const gone = new Set<string>()
  for (const r of pou.routines) {
    const fb = r.fb?.toUpperCase()
    const layout = fb === undefined ? undefined : layouts.get(fb)
    if (!isInitPartKey(r.key) || fb === undefined || layout === undefined) {
      routines.push(r)
      continue
    }
    const fields = [...layout.fields]
    const body = r.body.filter((s) => {
      const b = bindingOf(s)
      const field = b !== undefined && proven.has(keyOf(fb, b.target.slot)) ? fields[b.target.slot] : undefined
      const value = field === undefined ? undefined : boundValue(b!.value)
      if (value === undefined) return true
      if (value.based) based.set(fb, [...(based.get(fb) ?? []), { field: field!.name.toUpperCase(), offset: value.offset }])
      else fields[b!.target.slot] = { ...field!, init: value.offset }
      return false
    })
    layouts.set(fb, { ...layout, fields })
    if (body.length === 0) gone.add(r.key)
    else routines.push(body.length === r.body.length ? r : { ...r, body })
  }
  const kept = (s: IrStmt): boolean => !folded.has(s) && !(s.kind === "eval" && s.value.kind === "invoke" && gone.has(s.value.routine))
  const init = (pou.init ?? []).filter(kept)
  const place = (s: IrSlot): IrSlot => ({ ...s, init: atBase(layouts, based, s.type, s.init) })
  const out: IrPou = {
    ...pou,
    slots: based.size === 0 ? slots : slots.map(place),
    globals: based.size === 0 ? pou.globals : pou.globals.map(place),
    layouts: pou.layouts.map((l) => layouts.get(l.name.toUpperCase())!),
    routines,
  }
  if (init.length > 0) out.init = init
  else delete out.init
  return out
}

/** `init` with every instance of a type in `based` holding each bound field at its own `__base` plus the offset — through
 *  arrays and the fields of structs and instances, where the image pass gave each instance its region (`image.ts`
 *  `instancesIn`). An instance of such a type with no region is a lowering bug: its field would start at 0. */
function atBase(layouts: ReadonlyMap<string, IrLayout>, based: ReadonlyMap<string, { field: string; offset: bigint }[]>, t: Type, init: IrInit): IrInit {
  const array = peelArray(t)
  if (array !== undefined)
    return typeof init === "object" && "elements" in init ? { elements: init.elements.map((e) => atBase(layouts, based, array.element, e)), rest: init.rest } : init
  if (t.kind !== "struct" && t.kind !== "function_block") return init
  const bound = based.get(t.name.toUpperCase()) ?? []
  const named = typeof init === "object" && "fields" in init ? init.fields : {}
  const base = named[BASE_FIELD.toUpperCase()]
  if (bound.length > 0 && typeof base !== "bigint") throw new LoweringBug(`an instance of ${t.name} the image pass gave no region`)
  const fields: Record<string, IrInit> = { ...named }
  for (const f of layouts.get(t.name.toUpperCase())?.fields ?? []) {
    const value = named[f.name.toUpperCase()]
    if (value !== undefined) fields[f.name.toUpperCase()] = atBase(layouts, based, f.type, value)
  }
  for (const b of bound) fields[b.field] = (base as bigint) + b.offset
  return typeof init === "object" ? { fields } : init
}
