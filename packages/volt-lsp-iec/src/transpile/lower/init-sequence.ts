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
import type { IrExpr, IrStmt } from "../ir/index.js"
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
      span: pending.span,
    })
    if (lowered === undefined) return undefined
    const assigned = Array.isArray(lowered) ? lowered : [lowered]
    const values = assigned.flatMap((a) => (a.kind === "assign" ? [a.value] : []))

    // A LATER DECLARATION HAS NOT BEEN INITIALIZED YET, and neither has a CONSTANT one: the whole sequence runs in
    // order, so `i : INT := ABS(other); other : INT := -7;` is 0 on SP21 (`cfold_non_constant_argument`). Here a
    // constant initializer is the slot's STARTING VALUE rather than a statement, so an earlier initializer would
    // read -7 and answer 7. Refused until the constants are sequenced too.
    const later = values.reduce<string | undefined>((f, v) => f ?? readsSlot(lw, v, (slot) => slot >= pending.slot), undefined)
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
    const instance = values.reduce<string | undefined>(
      (f, v) => f ?? readsSlot(lw, v, (slot) => lw.frame[slot]?.type.kind === "function_block", true),
      undefined,
    )
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
 * The name of the first slot of THIS FRAME the expression loads that `matches` — or undefined. A place with a
 * `root` is somebody else's storage (a global, an in-out, a routine's local) and is not this frame's slot at all,
 * which is what made a `VAR_EXTERNAL` read look like a later declaration.
 *
 * `intoMember` asks only about a load that reaches INSIDE the slot (`holder.started`), which is what separates
 * reading an instance's field from holding the instance itself. And `ADR(x)` is deliberately not a load of `x`: it
 * takes an ADDRESS, which is the same whenever it is taken.
 */
function readsSlot(lw: Lowering, e: IrExpr, matches: (slot: number) => boolean, intoMember = false): string | undefined {
  switch (e.kind) {
    case "load": {
      if (e.place.root !== undefined) return undefined
      const inside = e.place.path.length > 0
      if (intoMember && !inside) return undefined
      return matches(e.place.slot) ? (lw.frame[e.place.slot]?.name ?? "a later declaration") : undefined
    }
    case "convert":
      return readsSlot(lw, e.value, matches, intoMember)
    case "unary":
      return readsSlot(lw, e.operand, matches, intoMember)
    case "binary":
      return readsSlot(lw, e.left, matches, intoMember) ?? readsSlot(lw, e.right, matches, intoMember)
    case "builtin":
      return e.args.reduce<string | undefined>((found, a) => found ?? readsSlot(lw, a, matches, intoMember), undefined)
    default:
      return undefined
  }
}
