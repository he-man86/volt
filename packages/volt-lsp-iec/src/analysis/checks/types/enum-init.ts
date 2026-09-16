/**
 * enum-init (C0124 · types/). An enumeration member initialized with a value that can't convert to the enum's
 * (always integer) base type — e.g. a real literal `(A := 2.5)`. Two errors, not one: the compiler names the value
 * as no valid initialisation, and then the conversion it could not make (conformance `cc5_enum_init_not_convertible`).
 *
 * Zero-FP: keyed on `constEval` — an integer initializer folds to a `bigint`, a real one to a JS `number`.
 * Only a member whose initializer folds to a real (`number`) fires; integer literals/expressions, references
 * to sibling members, and anything that doesn't fold to a real (undefined) are skipped. A real literal is
 * LREAL by CODESYS default, which is the reported source type.
 */
import { scopeForUnit } from "../../../symbols/index.js"
import { constEval, REAL_LITERAL_TYPE } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkEnumInit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "type_decl" || unit.body.kind !== "enum") continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    for (const member of unit.body.values) {
      if (member.value === undefined) continue
      if (typeof constEval(member.value, scope) !== "number") continue // integer/undecidable → not a mismatch
      for (const message of [
        // the VALUE as written, then the conversion — UPPER-cased, as the IDE prints an enum's name
        ctx.messages.invalidEnumInitialisation(ctx.source.slice(member.value.span.start, member.value.span.end)),
        ctx.messages.enumInitNotConvertible(REAL_LITERAL_TYPE, unit.name.text.toUpperCase()),
      ])
        out.push({ severity: "error", span: member.value.span, source: SOURCE, code: "enum-init-not-convertible", message })
    }
  }
}
