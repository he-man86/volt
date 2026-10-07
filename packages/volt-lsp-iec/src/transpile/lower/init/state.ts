/**
 * The init step under construction: the state `initStep` and its walk share.
 */

import type { Type } from "../../../frontend/types/index.js"
import type { Lowering } from "../lowering.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { Symbol } from "../../../frontend/symbols/index.js"
import type { IrInit, IrStmt } from "../../ir/index.js"

export type Fb = Extract<Type, { kind: "function_block" }>

/**
 * A POU's init step while `initStep` builds it: the lowering, the span every statement is reported at, the root POU's
 * symbol and its project-tree application (for `instance-path`), the memos of the instance walk, the globals an FB_Init
 * argument reads, and the four statement lists in the order they run — the instance paths, the FB_Init calls (with the
 * initializers interleaved), the structured initializers re-applied after FB_Init, the init-slot METHOD calls.
 */
export interface InitStep {
  readonly lw: Lowering
  readonly span: Span
  readonly root: Symbol | undefined
  readonly application: string | undefined
  /** the global slots an FB_Init argument reads (`recordedArgument`) */
  readonly globalArguments: Set<number>
  /** whether a value of a type holds, at any depth, an instance running FB_Init (`holdsFbInit`) */
  readonly fbInitHeld: Map<string, boolean>
  /** whether a type's instances have anything for the init step to do (`reaches`) */
  readonly known: Map<string, boolean>
  readonly out: IrStmt[]
  readonly fbInitCalls: IrStmt[]
  readonly reapplied: IrStmt[]
  readonly slotCalls: IrStmt[]
  /** each layout's declared field initializers, as the first instance found them (`visitFields`) */
  readonly declaredInits: Map<string, IrInit[]>
}
