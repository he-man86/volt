/**
 * reference-assign (C0140 · types/). The `REF=` reference-assignment target is not a `REFERENCE TO` variable
 * (`i REF= x`).
 *
 * Zero-FP: fires only when the target's type is KNOWN and not a reference; an unknown target is skipped.
 *
 * C0141 "RHS needs write access" (re-verified live 2026-07-21 — the earlier "literal RHS is always fine" note
 * was wrong): a `REF=` RHS must be a writable variable. A non-zero literal (`REF= 314`) or a constant (`REF= K`)
 * errors; the sole exception is the literal `0`, the null-reference idiom (`REF= 0` stays valid). We flag only a
 * RHS that classifies as `constant` and does not fold to 0, so a writable var / unknown never false-positives.
 *
 * A plain LITERAL is EITHER error, and which one depends on the literal's OWN type — both measured, with
 * `bound : REFERENCE TO INT` in each:
 *   `bound REF= 7`   → "Cannot convert type 'SINT' to type 'REFERENCE TO INT'"  (`cc3_reference_assign`)
 *   `bound REF= 314` → "Reference assign needs variable with write access"       (`cc6_reference_assign_literal`)
 *
 * The rule those two pin is EXACT TYPE, not range. An untyped integer literal takes the smallest type that
 * holds it — 7 is SINT, 314 is INT — and a `REF=` demands that type BE the referenced one. 7 is inside INT's
 * range and is still refused; 314 equals it and gets through to the write-access rule. This is stricter than an
 * ordinary assignment, where fitting the range is enough, which is why it is spelled here and not in
 * `literalErrorType` (shared with every other assignment, where the range rule is right).
 *
 * TWO measurements is what this rests on, so it claims nothing wider: a literal whose own type EQUALS the
 * referenced type falls through to C0141, and every other literal keeps the conversion error it already had.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, constancyOf, constEval, literalErrorType, renderType } from "../../../types/index.js"
import { integerLiteralType } from "../../../types/elementary.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkReferenceAssign(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== "REF=") return
      const target = inferExprType(s.target, scope, ctx.project)
      if (target.kind !== "reference" && target.kind !== "unknown") {
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "reference-assign-target", message: ctx.messages.referenceAssignTarget() }) // C0140
        return
      }
      // C0141 — the RHS must be writable. `0` is the null idiom (skip); a named CONSTANT has no write access.
      // A plain LITERAL is a TYPE error instead: the compiler types it and refuses the store into the reference.
      if (constEval(s.value, scope) === 0n) return
      if (s.value.kind === "literal") {
        // Does the literal's OWN type ALREADY equal the referenced one? Then the store is accepted and the
        // compiler goes on to the write-access rule — fall through. Anything else keeps the conversion error.
        const referenced = target.kind === "reference" ? target.target : undefined
        const own =
          s.value.literalKind === "int" && typeof s.value.value === "bigint"
            ? integerLiteralType(s.value.value)
            : undefined
        const exact =
          own !== undefined && referenced?.kind === "elementary" && referenced.elem.name === own.name
        if (!exact) {
          const from = literalErrorType(s.value, target)
          if (from !== undefined)
            out.push({
              severity: "error",
              span: s.value.span,
              source: SOURCE,
              code: "assignment-type-mismatch",
              message: ctx.messages.cannotConvert(renderType(from), renderType(target)),
            })
          return
        }
      }
      if (constancyOf(s.value, scope) === "constant")
        out.push({ severity: "error", span: s.value.span, source: SOURCE, code: "reference-assign-write", message: ctx.messages.referenceAssignWriteAccess() })
    })
  }
}
