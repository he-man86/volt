/**
 * Per-vendor diagnostic message builders (Layer D, D.1). Every diagnostic the LSP shares with a
 * compiler must read BYTE-IDENTICAL to it, per vendor — that parity is enforced by the conformance
 * oracle (T.1). Routing all wording through this one module is what makes a new check parity-correct
 * by construction. Vendor differences are data here, not scattered `if (vendor === …)` in the checks.
 *
 * EVERY message text lives in this folder, the parse errors' included, one file per check
 * group (analysis-conformance 1.11; openspec lsp-same-standard design.md §2.2): `shared.ts` the builders several groups'
 * checks call, then one slice per group, the group being that of every check that calls the builder. Each slice holds
 * ONE template per message for both vendors — a difference is a switch on `VendorWording` inside it, decided once in
 * `messagesFor` — so neither vendor's text is a copy that can drift from the other's recordings.
 */
import type { Vendor } from "../config.js"
import { callMessages, type CallMessages } from "./calls.js"
import { declarationMessages, type DeclarationMessages } from "./declarations.js"
import { flowMessages, type FlowMessages } from "./flow.js"
import { nameMessages, type NameMessages } from "./names.js"
import { oopMessages, type OopMessages } from "./oop.js"
import { pragmaMessages, type PragmaMessages } from "./pragmas.js"
import { sharedMessages, type SharedMessages, type VendorWording } from "./shared.js"
import { syntaxMessages, type SyntaxMessages } from "./syntax.js"
import { typeMessages, type TypeMessages } from "./types.js"

export { compilerStringLiteralText } from "./shared.js"
export type { LifecycleMethod } from "./oop.js"

/** The slices' key sets, in `messagesFor`'s spread order. */
type SliceKeys = [
  keyof SharedMessages,
  keyof TypeMessages,
  keyof DeclarationMessages,
  keyof NameMessages,
  keyof OopMessages,
  keyof CallMessages,
  keyof FlowMessages,
  keyof PragmaMessages,
  keyof SyntaxMessages,
]

/** The keys two slices share — `never` when the slices are disjoint. */
type Overlap<K extends readonly PropertyKey[]> = K extends readonly [infer H extends PropertyKey, ...infer R extends readonly PropertyKey[]]
  ? (H & R[number]) | Overlap<R>
  : never

/**
 * Every message builder: the intersection of the group slices — and `never`, a `bun typecheck` error in `messagesFor` and
 * at every reader, when a key is declared in two slices, so the spread composing them can never let a later slice
 * silently override an earlier one's text.
 */
export type Messages = [Overlap<SliceKeys>] extends [never]
  ? SharedMessages &
      TypeMessages &
      DeclarationMessages &
      NameMessages &
      OopMessages &
      CallMessages &
      FlowMessages &
      PragmaMessages &
      SyntaxMessages
  : never

export function messagesFor(vendor: Vendor): Messages {
  const tc = vendor === "twincat"
  const w: VendorWording = { tc, possible: tc ? "possible" : "Possible" }
  return {
    ...sharedMessages(w),
    ...typeMessages(w),
    ...declarationMessages(w),
    ...nameMessages(w),
    ...oopMessages(w),
    ...callMessages(w),
    ...flowMessages(w),
    ...pragmaMessages(w),
    ...syntaxMessages(w),
  }
}
