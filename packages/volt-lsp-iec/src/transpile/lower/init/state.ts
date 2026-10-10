/**
 * The init model's state: a frame's initializers that RUN (queued by `storage/declare.ts`, sequenced by `sequence.ts`),
 * and the init step under construction — the state `initStep` and its walk share.
 */

import type { Type } from "../../../frontend/types/index.js"
import { frameState, type Lowering } from "../core/lowering.js"
import type { Expr, Identifier, Span } from "../../../frontend/syntax/index.js"
import type { Symbol } from "../../../frontend/symbols/index.js"
import type { IrInit, IrStmt } from "../../ir/index.js"

export type Fb = Extract<Type, { kind: "function_block" }>

/**
 * A declaration whose initial value is NOT a constant — the slot takes its default and this runs in the init step.
 *
 * A CODESYS initializer is an initialisation SEQUENCE, measured on SP21 (`declarations/init-sequence.ts`): it runs
 * ONCE before the first scan, after the globals, in strict DECLARATION ORDER, and the expression may be anything —
 * `ADR(x)`, `THIS`, a struct member, a global, a call to a user FUNCTION. Declaration order is not decoration:
 * `other : INT := -7; i : INT := ABS(other);` gives 7 and the same pair written the other way round gives 0,
 * because `other` is still at its default when the earlier initializer reads it. Keeping these in the order they
 * were declared is what reproduces that, so nothing else has to.
 *
 * The EXPRESSION is kept, not a lowered value: it is lowered once every slot exists, so an initializer may name a
 * variable declared after it — which `ADR(x)` does 180 times in the corpus.
 */
export interface PendingInit {
  name: Identifier
  type: Type
  expr: Expr
  span: Span
  slot: number
  op?: "REF="
  /** One dynamic ELEMENT or FIELD of an aggregate initializer (`arr[1]`, `rec.c`) — the place it assigns; the slot's own
   *  `IrInit` holds the static part (`var_temp_dynamic_aggregate_init`: each re-evaluated per call, M5.1.7). Absent: the
   *  whole variable is `name`. */
  target?: Expr
}

/** A frame's initializers that run rather than fold (each was a field of the `Lowering`). */
export interface InitFrame {
  /** Every non-constant initializer of the frame, in declaration order (`PendingInit`). */
  readonly pendingInits: PendingInit[]
  /** A VAR_TEMP's initializer that is not a constant — and a METHOD's or FUNCTION's VAR's, its temporary section — by
   *  its LOCAL slot (both are per-run locals, `Lowering.perRun`): it runs at the start of EVERY run of the body
   *  (`localInits`), never in the
   *  run-once init step — `var_temp_dynamic_init` reads 9 then 10 (transpile-review 24), `var_temp_dynamic_init_method`,
   *  `_function` likewise. Several per slot for an aggregate's dynamic elements (`PendingInit.target`). */
  readonly tempInits: Map<number, PendingInit[]>
  /** The frame's VAR CONSTANT slots — compile-time values, never a statement of the walk (`position.ts`). */
  readonly constants: Set<number>
  /** `pendingInits` lowered, memoized — built BEFORE any body, so a pointer this step fills is known to be filled
   *  when a body dereferences it (`pointerTargets`), and consumed by the init step at the end. `statements`
   *  undefined means the build failed or is in progress. `bySlot` is the same statements, per declaration they
   *  initialize — the init step interleaves them with the FB_Inits by position (transpile-review 23). */
  initSequence?: { statements: IrStmt[] | undefined; bySlot?: { slot: number; statements: IrStmt[] }[] }
}

export const initFrame = frameState<InitFrame>(() => ({ pendingInits: [], tempInits: new Map(), constants: new Set() }))

/**
 * A POU's init step while `initStep` builds it: the lowering, the span every statement is reported at, the root POU's
 * symbol and its project-tree application (for `instance-path`), the memos of the instance walk, the globals an FB_Init
 * argument reads, and the three statement lists in the order they run — the instance paths, one instance's walk while
 * `visit` builds it (its fields, FB_Inits and structured initializer, `fbInitCalls`), the init-slot METHOD calls.
 */
export interface InitStep {
  readonly lw: Lowering
  readonly span: Span
  readonly root: Symbol | undefined
  readonly application: string | undefined
  /** the global slots an FB_Init argument reads (`recordedArgument`) */
  readonly globalArguments: Set<number>
  /** whether a value of a type holds, at any depth, an instance running FB_Init (`reachesFbInit`, "fb-init") */
  readonly fbInitHeld: Map<string, boolean>
  /** whether a type's instances have anything for the init step to do (`reachesFbInit`, "init-step") */
  readonly known: Map<string, boolean>
  readonly out: IrStmt[]
  readonly fbInitCalls: IrStmt[]
  readonly slotCalls: IrStmt[]
  /** each layout's declared field initializers, as the first instance found them (`visitFields`) */
  readonly declaredInits: Map<string, IrInit[]>
}

/** How many initializers that RUN the FB type `name`'s frame queued — 0 for a type with no body lowering reaches. */
export function pendingInitsOf(lw: Lowering, name: string): number {
  const body = lw.bodies.get(name.toUpperCase())
  return body === undefined ? 0 : initFrame(body.lowering).pendingInits.length
}
