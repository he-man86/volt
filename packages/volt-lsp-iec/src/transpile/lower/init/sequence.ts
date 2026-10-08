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
 * `storage/declare.ts` queues the ones that do not fold (`InitFrame.pendingInits`); this turns them into statements. Order
 * is what makes the values right, so nothing here has a rule about it: they come out in the order they were
 * declared, and a slot whose own initializer has not run yet still holds its default.
 *
 * Built EARLY — while the layout is, before any body lowers — because a body may dereference a pointer this step
 * fills, and `pointer-order` only allows that once the store is known (`pointerTargets`).
 */

import type { Lowering } from "../core/lowering.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import { findPlace, initReadChildren } from "../../ir/walk.js"
import { insideInstance } from "../places/path.js"
import { lowerStmt } from "../statements/statements.js"
import { initFrame, type PendingInit } from "./state.js"

/**
 * `lw.pendingInits`, lowered as the assignments they are — or undefined when one of them cannot be.
 *
 * Built through `lowerStmt` rather than as a bare expression, so everything an assignment knows applies: `ADR(x)`
 * into a pointer, `REF=`, a string's capacity. Lowering the value alone refused `p : POINTER TO INT := ADR(x)` as
 * `expr-call`, and that is the shape the corpus writes 180 times.
 */
export function buildInitSequence(lw: Lowering): IrStmt[] | undefined {
  const frame = initFrame(lw)
  if (frame.initSequence !== undefined) return frame.initSequence.statements
  frame.initSequence = { statements: undefined }
  const out: IrStmt[] = []
  const bySlot: { slot: number; statements: IrStmt[] }[] = []
  for (const pending of initFrame(lw).pendingInits) {
    const assigned = lowerPendingInit(lw, pending)
    if (assigned === undefined) return undefined
    const values = assigned.flatMap((a) => (a.kind === "assign" ? [a.value] : []))

    // A LATER DECLARATION HAS NOT BEEN INITIALIZED YET, and neither has a CONSTANT one: the whole sequence runs in
    // order, so `i : INT := ABS(other); other : INT := -7;` is 0 on SP21 (`cfold_non_constant_argument`). Here a
    // constant initializer is the slot's STARTING VALUE rather than a statement, so an earlier initializer would
    // read -7 and answer 7. Refused until the constants are sequenced too.
    const later = values.reduce<string | undefined>((f, v) => f ?? reads(v, laterThan(lw, pending.slot)), undefined)
    if (later !== undefined)
      return lw.bail(
        "init-reads-later",
        `${pending.name.text}'s initial value reads ${later}, which is declared after it and has not been initialized yet`,
        pending.span,
      )

    // AN FB INSTANCE'S FIELD, whose own FB_Init runs at ITS declaration's position — `seen : INT := holder.started`
    // is 5 with `holder` declared first and 0 with it declared last (`initseq_after_fb_init`,
    // `initseq_fb_init_declared_last`). The init step interleaves these statements with the FB_Inits by declaration
    // (transpile-review 23), which answers that — except for an instance declared with a STRUCTURED initializer, which
    // is applied after every FB_Init (`fb_init_and_structured_initializer`), so what a sibling reads of it is not.
    const instance = values.reduce<string | undefined>((f, v) => f ?? reads(v, insideInstance(lw)), undefined)
    if (instance !== undefined)
      return lw.bail(
        "init-reads-instance",
        `${pending.name.text}'s initial value reads ${instance}, an instance declared with a structured initializer applied after the FB_Inits`,
        pending.span,
      )
    out.push(...assigned)
    bySlot.push({ slot: pending.slot, statements: assigned })
  }
  initFrame(lw).initSequence = { statements: out, bySlot }
  return out
}

/** One queued initializer, lowered as the assignment it is — also a VAR_TEMP's, on every run (`resetTemps`). */
export function lowerPendingInit(lw: Lowering, pending: PendingInit): IrStmt[] | undefined {
  const lowered = lowerStmt(lw, {
    kind: "assign",
    target: { kind: "ident_expr", name: pending.name.text, span: pending.name.span },
    value: pending.expr,
    // `REF=` from the DECLARATION, carried through `pendingInits` — `bindReference` is what records the
    // reference`s target, and an assign with no `op` is a store through a reference nothing bound.
    ...(pending.op !== undefined ? { op: pending.op } : {}),
    span: pending.span,
  })
  return lowered === undefined ? undefined : Array.isArray(lowered) ? lowered : [lowered]
}

/**
 * The first place the expression READS for which `onPlace` gives a name — or undefined. Every expression that can
 * hold a read is walked: a call's inputs, its in-out bindings and the instance it runs on, and the index
 * expressions inside a place (`arr[k]` reads `k` too). Each of those was a hole, and each let a guard through. The walk
 * is `ir/walk.ts`'s, with the read order and skip set this walk has always had (`initReadChildren`, until task 5.9).
 *
 * `ADR(x)` is deliberately NOT a read of `x`: it takes an ADDRESS, which is the same whenever it is taken, and the
 * corpus writes it 180 times.
 */
export function reads(e: IrExpr, onPlace: (place: Place) => string | undefined): string | undefined {
  return findPlace(e, onPlace, initReadChildren)
}

/**
 * A place that is THIS FRAME's slot at index `slot` or later. A place with a `root` is somebody else's storage — a
 * global, an in-out, a routine's local — and is not this frame's slot at all, which is what made a `VAR_EXTERNAL`
 * read look like a later declaration.
 */
export const laterThan =
  (lw: Lowering, slot: number) =>
  (place: Place): string | undefined =>
    place.root === undefined && place.slot >= slot ? (lw.slots[place.slot]?.name ?? "a later declaration") : undefined
