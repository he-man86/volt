/**
 * WHERE `THIS` AND `SUPER` MEAN SOMETHING — the compiler's rule, one home for the check that reports them out of place
 * (`analysis/checks/flow/this-super-context`, C0045 / C0122) and the hover that describes them only where they are in
 * place (`services/assist/builtin-hover`). Neither has an instance in a PROGRAM or a FUNCTION; `SUPER` has nothing to
 * name where the nearest enclosing POU declares no EXTENDS (a method's base is its owner's). Gated on the DECLARATION
 * saying nothing about a base, not on the base having resolved: a base from a library this analysis cannot see is a base.
 */
import type { TopLevel } from "../syntax/index.js"
import type { Scope } from "./model.js"
import { enclosingPou } from "./scope-nav.js"

/** A PROGRAM or a FUNCTION: no instance, so neither THIS nor SUPER means anything in its body. */
export const instanceless = (unit: TopLevel): boolean => unit.kind === "program" || unit.kind === "function"

/** True when the nearest POU `scope` sits in declares no EXTENDS at all. */
export function declaresNoBase(scope: Scope): boolean {
  const pou = enclosingPou(scope)
  return pou !== undefined && pou.extendsName === undefined
}

/** Whether `which` means something in the body of `unit`, whose scope is `scope`. */
export function selfRefAllowed(which: "THIS" | "SUPER", unit: TopLevel, scope: Scope): boolean {
  if (instanceless(unit)) return false
  return which === "THIS" || !declaresNoBase(scope)
}
