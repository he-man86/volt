/**
 * What the interface model keeps: per frame, the instances it is lent and the queries hoisted before an IF; per POU
 * lowering, every instance stored into an interface and what each interface variable may hold.
 */

import type { Place, IrExpr } from "../../ir/index.js"
import { type FbType, frameState } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"

/** A frame's interface state (each was a field of the `Lowering`). */
interface InterfaceFrame {
  /** The FB instances of other frames this body is lent per call, by tag — its `lent` places (`interfaces/lend.ts`). */
  readonly lends: { tag: number; type: FbType }[]
  /** A `__QUERYINTERFACE` call an IF condition leads with, by its AST node → the hidden BOOL its query was taken into
   *  just before the IF (`queryCondition`); the call reads it where the condition lowers (`lowerBuiltin`). */
  readonly hoistedQueries: Map<object, IrExpr>
}

export const interfaceFrame = frameState<InterfaceFrame>(() => ({ lends: [], hoistedQueries: new Map() }))

/** The POU lowering's interface tables (each was a field of `Shared`). */
interface InterfaceTables {
  /** Every FB instance stored into an interface, at the index its tag names (`core/tags.ts`), with the frame its place indexes (`interfaces/tags.ts`). */
  readonly instances: { place: Place; context: string; fb: FbType }[]
  /** What each interface variable may hold, by `pointerKey`: the tags stored into it, and the variables copied into it
   *  (`only`: through __QUERYINTERFACE, the instances implementing that interface). */
  //  `foreign`: the value arrived through a write reached through another instance (an in-out, a lent instance, a global)
  //  — which instance an instance-relative tag names is then not tracked (`interfaces/lend.ts`).
  readonly interfaces: Map<string, { tags: Map<number, boolean>; from: { key: string; only?: string; foreign: boolean }[] }>
}

export const interfaceTables = sharedState<InterfaceTables>(() => ({ instances: [], interfaces: new Map() }))
