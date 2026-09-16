/**
 * body-context — the name CODESYS gives a POU body when it names one in a message: a method or action is its own
 * name, a property accessor is `__get<Prop>` / `__set<Prop>`, and an FB's or program's MAIN body is `__MAIN`
 * (conformance `xo3_inout_chain_four_deep` says 'Deeper', `cc5_inout_external_access` says '__MAIN').
 *
 * Shared by the two VAR_IN_OUT checks, which name the accessing body for the same C0371 warning.
 */
import type { BodySpan, Property, TopLevel } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"

export const MAIN_BODY = "__MAIN"

export function bodyContext(scope: Scope, unit: TopLevel, body: BodySpan): string {
  if (scope.kind === "method") return scope.name // method or action
  if (scope.kind === "accessor" && unit.kind === "property") {
    const p = unit as Property
    if (p.getter !== undefined && p.getter.body.span.start === body.span.start) return `__get${p.name.text}`
    if (p.setter !== undefined && p.setter.body.span.start === body.span.start) return `__set${p.name.text}`
  }
  return MAIN_BODY
}
