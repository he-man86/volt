/**
 * Lowering's view of a routine's parameters: the VAR_IN_OUT sections of a chain, the positional order, a section
 * under a prefix.
 */

import type { PendingBody } from "../lowering.js"
import type { VarSection } from "../../../frontend/syntax/index.js"
import { routineFacts } from "./facts.js"

export const inOutSections = (chain: readonly PendingBody["unit"][]) => chain.flatMap((u) => u.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))

/** A section whose every name carries `prefix` — how a routine's kept variables get a name of their own in the frame. */
export const prefixed = (section: VarSection, prefix: string): VarSection => ({
  ...section,
  decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `${prefix}${n.text}` })) })),
})

/**
 * THE POSITIONAL PARAMETER ORDER of a routine, derived ONCE from its declaration: every VAR_INPUT, VAR_IN_OUT and
 * VAR_OUTPUT name in the order written, which is what an argument with no `param :=` binds to.
 *
 * Two places built this from the same AST with the same filter — the ANY-variant pass and `positionalOf` — so a change
 * to either (a section admitted, an order) would have left them disagreeing about what `f(a, b)` means, in a way
 * nothing compares.
 */
export function positionalParameters(sections: readonly VarSection[]): {
  name: string
  output: boolean
  sectionKind: VarSection["sectionKind"]
  type: VarSection["decls"][number]["type"]
}[] {
  return sections
    .filter((s) => s.sectionKind === "VAR_INPUT" || s.sectionKind === "VAR_IN_OUT" || s.sectionKind === "VAR_OUTPUT")
    .flatMap((s) =>
      s.decls.flatMap((d) => d.names.map((n) => ({ name: n.text, output: s.sectionKind === "VAR_OUTPUT", sectionKind: s.sectionKind, type: d.type }))),
    )
}

/** Each routine's parameters in declaration order — VAR_INPUT, VAR_IN_OUT and VAR_OUTPUT as written: the order a
 *  positional argument binds in (conformance `callshape_positional_arguments`). */
export const positionalOf = routineFacts<readonly { name: string; output: boolean }[]>()
