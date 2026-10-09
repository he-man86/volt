/**
 * THE IMAGE PASS'S REWRITE (model 3, design.md §3.3 step 4d): once `image.ts` laid the image out, every place that reaches
 * a variable it holds becomes an `image` place (`semantics/memory.toImage`, the one rewrite), in every body the POU
 * lowered. A VAR_IN_OUT bound to one becomes a COPY lent for the call and written back after it — an image place is no
 * Rust lvalue — which is exact unless the callee also reaches the image while it holds the copy: that is refused
 * (`call-inout-alias`). And an instance of an escaped FB type that no static region holds — a METHOD's or FUNCTION's
 * local, a VAR_TEMP — is refused (`image-stack`): a region per call is not built.
 */
import type { IrBinding, IrLayout, IrRoutine, IrSlot, IrStmt, Place } from "../../ir/index.js"
import { callsIn, type IrNode, isPlace, mapPlaces, someNode } from "../../ir/walk.js"
import { type ImageRoot, toImage } from "../../semantics/index.js"
import type { Lowering } from "../core/lowering.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { escapesOf } from "./escape.js"

/** What one body's places index: its frame's slots (or the instance's fields), its locals, its in-outs, its lent
 *  instances — and, in an FB's body or a METHOD, the FB its plain slots are fields of. */
interface BodyFrame {
  readonly slots: readonly IrSlot[]
  readonly fieldsOf?: Type
  readonly locals?: readonly IrSlot[]
  readonly inouts?: readonly IrSlot[]
  readonly lent?: readonly { type: Type }[]
}

/** Every body of the POU rewritten into the image, or undefined — refused — when one cannot be. */
export function rewriteImage(
  lw: Lowering,
  pou: { slots: readonly IrSlot[]; globals: readonly IrSlot[]; body: readonly IrStmt[]; init?: readonly IrStmt[]; span: Span },
): { body: IrStmt[]; init?: IrStmt[]; layouts: IrLayout[]; routines: IrRoutine[] } | undefined {
  if (refuseStackInstances(lw, pou.slots, pou.span)) return undefined
  const layouts = new Map([...lw.layouts.values()].map((l) => [l.name.toUpperCase(), l]))
  const routines = [...lw.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  const rewrite = (stmts: readonly IrStmt[], frame: BodyFrame): IrStmt[] =>
    stmts.map((s) => mapPlaces(s, (p) => imaged(p, frame, pou.globals, layouts), copyOf))
  const own: BodyFrame = { slots: pou.slots }
  const body = rewrite(pou.body, own)
  const init = pou.init === undefined ? undefined : rewrite(pou.init, own)
  const newLayouts = [...layouts.values()].map((l): IrLayout => {
    if (l.body === undefined) return l
    const type = { kind: "function_block", name: l.name } as Type
    return { ...l, body: rewrite(l.body, { slots: l.fields, fieldsOf: type, inouts: l.inouts ?? [], lent: l.lent ?? [] }) }
  })
  const newRoutines = routines.map((r): IrRoutine => {
    const fb = r.fb === undefined ? undefined : layouts.get(r.fb.toUpperCase())
    const frame: BodyFrame = { slots: fb?.fields ?? [], locals: r.locals, inouts: r.inouts, lent: r.lent ?? [], ...(fb === undefined ? {} : { fieldsOf: { kind: "function_block", name: fb.name } as Type }) }
    return { ...r, body: rewrite(r.body, frame) }
  })
  const bodies = [body, ...(init === undefined ? [] : [init]), ...newLayouts.flatMap((l) => (l.body === undefined ? [] : [l.body])), ...newRoutines.map((r) => r.body)]
  // every `ADR(x)` the escape pass let lower names a variable the image now holds; one it does not is the passes
  // disagreeing about what escaped — said by name, never printed as an address of nothing
  if (bodies.some((b) => someNode(b, (n) => !isPlace(n) && n.kind === "address" && n.place.root !== "image"))) {
    lw.bail("pointer-targets", "an address of a variable the byte image does not hold, which the escape pass did not find stored", pou.span)
    return undefined
  }
  if (refuseImageAlias(lw, [body, ...(init === undefined ? [] : [init])], newLayouts, newRoutines)) return undefined
  return { body, ...(init === undefined ? {} : { init }), layouts: newLayouts, routines: newRoutines }
}

/** Whether any of these bodies reaches the image. */
export const anyImage = (bodies: readonly (readonly IrStmt[])[]): boolean => bodies.some((b) => reachesImage(b))

/** A place in the image, if it reaches one (`toImage`) — else the place as it was. A plain slot of an FB's body or METHOD
 *  is a field of its instance, so it is asked as `THIS^.field`. */
function imaged(p: Place, frame: BodyFrame, globals: readonly IrSlot[], layouts: ReadonlyMap<string, IrLayout>): Place {
  if (p.root === "image") return p
  let asked = p
  let root: ImageRoot | undefined
  switch (p.root) {
    case undefined:
      if (frame.fieldsOf !== undefined) {
        asked = { ...p, root: "this", slot: 0, path: [{ kind: "field", name: frame.slots[p.slot]!.name }, ...p.path] }
        root = { type: frame.fieldsOf }
      } else root = slotRoot(frame.slots[p.slot])
      break
    case "this":
      root = frame.fieldsOf === undefined ? undefined : { type: frame.fieldsOf }
      break
    case "global":
      root = slotRoot(globals[p.slot])
      break
    case "local":
      root = slotRoot(frame.locals?.[p.slot])
      break
    case "inout":
      root = slotRoot(frame.inouts?.[p.slot])
      break
    case "lent":
      root = frame.lent?.[p.slot] === undefined ? undefined : { type: frame.lent[p.slot]!.type }
      break
  }
  if (root === undefined) return p
  const image = toImage(asked, root, layouts)
  return image.root === "image" ? image : p
}

const slotRoot = (slot: IrSlot | undefined): ImageRoot | undefined =>
  slot === undefined ? undefined : { type: slot.type, ...(slot.image === undefined ? {} : { address: slot.image }) }

/** A VAR_IN_OUT bound to an image place: a copy lent for the call and written back after it — an image place is no
 *  Rust lvalue. Any other binding as it was. */
function copyOf(b: IrBinding): IrBinding {
  if ("kind" in b || b.root !== "image") return b
  return { kind: "copy", value: { kind: "load", place: b, type: b.type, span: b.span }, type: b.type, back: b, span: b.span }
}

/** Whether a node reaches the image — an image place, or an address in it. */
const reachesImage = (root: IrNode | readonly IrNode[]): boolean =>
  someNode(root, (n) => (isPlace(n) ? n.root === "image" : n.kind === "address"))

/**
 * A call that lends a copy of an image place, whose callee — or anything it calls — also reaches the image: refused
 * (`call-inout-alias`), true when refused. The callee would read and write the image while the call holds the copy, and
 * the copy written back last would undo what it wrote.
 */
function refuseImageAlias(lw: Lowering, bodies: readonly (readonly IrStmt[])[], layouts: readonly IrLayout[], routines: readonly IrRoutine[]): boolean {
  const bodyOf = new Map<string, readonly IrStmt[]>([
    ...layouts.flatMap((l): [string, readonly IrStmt[]][] => (l.body === undefined ? [] : [[`FB:${l.name.toUpperCase()}`, l.body]])),
    ...routines.map((r): [string, readonly IrStmt[]] => [`R:${r.key}`, r.body]),
  ])
  const memo = new Map<string, boolean>()
  const touches = (key: string): boolean => {
    const known = memo.get(key)
    if (known !== undefined) return known
    memo.set(key, false)
    const body = bodyOf.get(key) ?? []
    const answer = reachesImage(body) || callsIn(body).some((c) => touches(c.kind === "call" ? `FB:${c.fb.toUpperCase()}` : `R:${c.routine}`))
    memo.set(key, answer)
    return answer
  }
  for (const body of [...bodies, ...bodyOf.values()])
    for (const c of callsIn(body)) {
      const lent = c.inouts.some((b) => "kind" in b && b.back?.root === "image")
      if (lent && touches(c.kind === "call" ? `FB:${c.fb.toUpperCase()}` : `R:${c.routine}`)) {
        lw.bail("call-inout-alias", "a VAR_IN_OUT bound to a variable in the byte image, whose callee reaches the image too while the call holds its copy", c.span)
        return true
      }
    }
  return false
}

/** An instance of an escaped FB type held where no static region is: a METHOD's or FUNCTION's local, a VAR_TEMP, a
 *  lowering temp — refused (`image-stack`), true when refused. */
function refuseStackInstances(lw: Lowering, slots: readonly IrSlot[], span: Span): boolean {
  const escaped = escapesOf(lw).types
  if (escaped.size === 0) return false
  const holds = (t: Type): boolean => {
    const array = peelArray(t)
    if (array !== undefined) return holds(array.element)
    if (t.kind === "function_block") return escaped.has(t.name.toUpperCase()) || (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => f.section !== "VAR_STAT" && holds(f.type))
    return t.kind === "struct" && (lw.layouts.get(t.name.toUpperCase())?.fields ?? []).some((f) => holds(f.type))
  }
  const stacked = (s: IrSlot): boolean => (s.section === "VAR_TEMP" || s.section === "temp") && holds(s.type)
  const routines = [...lw.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  const found =
    slots.find(stacked) ??
    [...lw.layouts.values()].flatMap((l) => l.fields).find(stacked) ??
    routines.flatMap((r) => r.locals).find((s) => holds(s.type))
  if (found === undefined) return false
  lw.bail("image-stack", `${found.name} holds an instance whose data lives in the byte image, where a region per call would be needed`, span)
  return true
}
