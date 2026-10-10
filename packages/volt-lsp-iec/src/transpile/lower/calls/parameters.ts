/**
 * Lowering's view of a routine's parameters: the VAR_IN_OUT sections of a chain, the positional order, a section
 * under a prefix.
 */

import type { PendingBody } from "../core/shared.js"
import type { VarSection } from "../../../frontend/syntax/index.js"
import { isPositionalSection } from "../../../frontend/types/index.js"
import { routineFacts } from "./facts.js"

export const inOutSections = (chain: readonly PendingBody["unit"][]) => chain.flatMap((u) => u.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))

/** A section whose every name carries `prefix` — how a routine's kept variables get a name of their own in the frame. */
export const prefixed = (section: VarSection, prefix: string): VarSection => ({
  ...section,
  decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `${prefix}${n.text}` })) })),
})

/**
 * THE POSITIONAL PARAMETER ORDER of a routine, derived ONCE from its declaration: every VAR_INPUT and VAR_IN_OUT name in
 * the order written, which is what an argument with no `param :=` binds to — the front-end's rule
 * (`types/infer/callee` `isPositionalSection`): a VAR_OUTPUT declared among them is skipped (`tr_b4_positional_past_output`,
 * transpile-restructure 6.B.4; lowering refused such a call until it was recorded).
 *
 * Two places built this from the same AST with the same filter — the ANY-variant pass and `positionalOf` — so a change
 * to either (a section admitted, an order) would have left them disagreeing about what `f(a, b)` means, in a way
 * nothing compares.
 */
export function positionalParameters(sections: readonly VarSection[]): {
  name: string
  sectionKind: VarSection["sectionKind"]
  type: VarSection["decls"][number]["type"]
}[] {
  return sections
    .filter((s) => isPositionalSection(s.sectionKind))
    .flatMap((s) => s.decls.flatMap((d) => d.names.map((n) => ({ name: n.text, sectionKind: s.sectionKind, type: d.type }))))
}

/** Each routine's positional parameters in declaration order — VAR_INPUT and VAR_IN_OUT as written: the order a
 *  positional argument binds in (conformance `callshape_positional_arguments`). */
export const positionalOf = routineFacts<readonly { name: string }[]>()

/**
 * WHAT LOWERING BINDS a positional argument at `position` to: the parameter declared there, or `past-parameters`. One
 * rule, read by the call's binding (`invoke.ts`) and by the differential test against the front-end
 * (`test/conformance/call-parameters.test.ts`).
 */
export function positionalBinding<P extends { name: string }>(declared: readonly P[], position: number): P | "past-parameters" {
  return declared[position] ?? "past-parameters"
}
