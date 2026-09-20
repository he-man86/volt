/**
 * THE INITIALISATION SEQUENCE — a declaration whose initial value RUNS rather than folding.
 *
 * Measured on SP21 (`declarations/init-sequence.ts`, `declarations/constant-folding.ts`). A CODESYS initializer is
 * not a constant expression that happens to allow names; it is a statement that runs:
 *
 *   ONCE, before the first scan   `startedAt : INT := counter` is 0 after three scans that bump `counter` to 3
 *   after the globals            a function reading a global that starts at 41 returns 42
 *   in DECLARATION ORDER         `i : INT := ABS(other)` is 7 with `other` declared before it and 0 after
 *   any expression               `ADR(x)`, `THIS`, a struct member, a global, a call to a user FUNCTION
 *
 * `storage.ts` queues the ones that do not fold (`Lowering.pendingInits`); this turns them into statements. Order
 * is what makes the values right, so nothing here has a rule about it: they come out in the order they were
 * declared, and a slot whose own initializer has not run yet still holds its default.
 *
 * Built EARLY — while the layout is, before any body lowers — because a body may dereference a pointer this step
 * fills, and `pointer-order` only allows that once the store is known (`shared.pointers`).
 */
import { peelArray, type IrExpr, type IrInvoke, type IrStmt, type Place } from "../ir/index.js"
import type { Type } from "../../types/index.js"
import type { Lowering } from "./lowering.js"
import { lowerStmt } from "./statements.js"

/**
 * `lw.pendingInits`, lowered as the assignments they are — or undefined when one of them cannot be.
 *
 * Built through `lowerStmt` rather than as a bare expression, so everything an assignment knows applies: `ADR(x)`
 * into a pointer, `REF=`, a string's capacity. Lowering the value alone refused `p : POINTER TO INT := ADR(x)` as
 * `expr-call`, and that is the shape the corpus writes 180 times.
 */
export function buildInitSequence(lw: Lowering): IrStmt[] | undefined {
  if (lw.initSequence !== undefined) return lw.initSequence.statements
  lw.initSequence = { statements: undefined }
  const out: IrStmt[] = []
  for (const pending of lw.pendingInits) {
    const lowered = lowerStmt(lw, {
      kind: "assign",
      target: { kind: "ident_expr", name: pending.name.text, span: pending.name.span },
      value: pending.expr,
      // `REF=` from the DECLARATION, carried through `pendingInits` — `bindReference` is what records the
      // reference`s target, and an assign with no `op` is a store through a reference nothing bound.
      ...(pending.op !== undefined ? { op: pending.op } : {}),
      span: pending.span,
    })
    if (lowered === undefined) return undefined
    const assigned = Array.isArray(lowered) ? lowered : [lowered]
    const values = assigned.flatMap((a) => (a.kind === "assign" ? [a.value] : []))

    // A LATER DECLARATION HAS NOT BEEN INITIALIZED YET, and neither has a CONSTANT one: the whole sequence runs in
    // order, so `i : INT := ABS(other); other : INT := -7;` is 0 on SP21 (`cfold_non_constant_argument`). Here a
    // constant initializer is the slot's STARTING VALUE rather than a statement, so an earlier initializer would
    // read -7 and answer 7. Refused until the constants are sequenced too.
    const later = values.reduce<string | undefined>((f, v) => f ?? reads(lw, v, laterThan(lw, pending.slot)), undefined)
    if (later !== undefined)
      return lw.bail(
        "init-reads-later",
        `${pending.name.text}'s initial value reads ${later}, which is declared after it and has not been initialized yet`,
        pending.span,
      )

    // AN FB INSTANCE'S FIELD, whose own FB_Init runs at ITS declaration's position — `seen : INT := holder.started`
    // is 5 with `holder` declared first and 0 with it declared last (`initseq_after_fb_init`,
    // `initseq_fb_init_declared_last`). These statements go in as one block relative to the FB_Init calls, so only
    // the first of those two would come out right. Interleaving the two by declaration position is what lifts it.
    const instance = values.reduce<string | undefined>((f, v) => f ?? reads(lw, v, insideInstance(lw)), undefined)
    if (instance !== undefined)
      return lw.bail(
        "init-reads-instance",
        `${pending.name.text}'s initial value reads ${instance}, an instance whose own FB_Init runs at its declaration's position`,
        pending.span,
      )
    out.push(...assigned)
  }
  lw.initSequence = { statements: out }
  return out
}

/**
 * The first place the expression READS for which `onPlace` gives a name — or undefined. Every expression that can
 * hold a read is walked: a call's inputs, its in-out bindings and the instance it runs on, and the index
 * expressions inside a place (`arr[k]` reads `k` too). Each of those was a hole, and each let a guard through.
 *
 * `ADR(x)` is deliberately NOT a read of `x`: it takes an ADDRESS, which is the same whenever it is taken, and the
 * corpus writes it 180 times.
 */
function reads(lw: Lowering, e: IrExpr, onPlace: (place: Place) => string | undefined): string | undefined {
  const walk = (x: IrExpr): string | undefined => reads(lw, x, onPlace)
  const first = (xs: readonly IrExpr[]): string | undefined => xs.reduce<string | undefined>((f, x) => f ?? walk(x), undefined)
  switch (e.kind) {
    case "load":
      return readsPlace(lw, e.place, onPlace)
    case "convert":
      return walk(e.value)
    case "unary":
      return walk(e.operand)
    case "binary":
      return walk(e.left) ?? walk(e.right)
    case "builtin":
      return first(e.args)
    case "invoke":
      return readsInvoke(lw, e, onPlace)
    case "dispatch":
      return walk(e.tag) ?? e.arms.reduce<string | undefined>((f, a) => f ?? readsInvoke(lw, a.call, onPlace), undefined)
    default:
      return undefined
  }
}

/** Everything a call reads: its inputs, its in-out bindings (a place, or a copy of an expression) and its instance. */
function readsInvoke(lw: Lowering, e: IrInvoke, onPlace: (place: Place) => string | undefined): string | undefined {
  const inputs = e.inputs.reduce<string | undefined>((f, x) => f ?? reads(lw, x, onPlace), undefined)
  if (inputs !== undefined) return inputs
  const bound = e.inouts.reduce<string | undefined>(
    (f, io) => f ?? ("kind" in io && io.kind === "copy" ? reads(lw, io.value, onPlace) : readsPlace(lw, io as Place, onPlace)),
    undefined,
  )
  if (bound !== undefined) return bound
  return e.instance === undefined ? undefined : readsPlace(lw, e.instance, onPlace)
}

function readsPlace(lw: Lowering, place: Place, onPlace: (place: Place) => string | undefined): string | undefined {
  for (const access of place.path)
    if (access.kind === "index") {
      const inside = reads(lw, access.index, onPlace)
      if (inside !== undefined) return inside
    }
  if (place.guard !== undefined) {
    const through = readsPlace(lw, place.guard, onPlace)
    if (through !== undefined) return through
  }
  return onPlace(place)
}

/**
 * A place that is THIS FRAME's slot at index `slot` or later. A place with a `root` is somebody else's storage — a
 * global, an in-out, a routine's local — and is not this frame's slot at all, which is what made a `VAR_EXTERNAL`
 * read look like a later declaration.
 */
const laterThan =
  (lw: Lowering, slot: number) =>
  (place: Place): string | undefined =>
    place.root === undefined && place.slot >= slot ? (lw.frame[place.slot]?.name ?? "a later declaration") : undefined

/**
 * A place that reads INSIDE a function block instance — at any depth, not only one held directly in the frame.
 * `holder : T_H; seen : INT := holder.inner.started` reaches an FB through a STRUCT field and slipped past a check
 * that only looked at the root slot's kind.
 */
const insideInstance =
  (lw: Lowering) =>
  (place: Place): string | undefined => {
    if (place.root !== undefined) return undefined
    const slot = lw.frame[place.slot]
    if (slot === undefined) return undefined
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
