/**
 * pointer-conversion (C0033 · types/). A WARNING when a pointer value is implicitly assigned to an elementary target
 * that cannot hold it (`w := ptr`). Which can is the TARGET's pointer width, the same on both vendors (`types/compat`
 * `pointerFits`, frontend-conformance 4.1.1): it was a vendor split read off two recording projects on different targets.
 * Where the target decides and is unknown, nothing is said.
 *
 * Zero-FP: only a KNOWN pointer RHS into a KNOWN elementary LHS fires; pointer→pointer (the legal case) and any
 * undecidable side are skipped. It is a warning, so it never affects the error-severity corpus gate.
 */
import { walkStatements } from "../../../frontend/syntax/index.js"
import { bodies, targetOf } from "../../../frontend/symbols/index.js"
import { inferExprType, pointerFits, renderType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkPointerConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  const target = targetOf(ctx.project)
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const rhs = inferExprType(s.value, scope, ctx.project)
      if (rhs.kind !== "pointer") return
      // a REFERENCE target is written through, so the pointer converts into what it refers to — and the message names
      // the reference: `rf := p` is "Cannot convert type 'POINTER TO INT' to type 'REFERENCE TO INT'"
      // (`cv_pointer_assigned_to_reference`, CODESYS 2026-10-03)
      const lhs = inferExprType(s.target, scope, ctx.project)
      const written = lhs.kind === "reference" ? lhs.target : lhs
      if (written.kind !== "elementary") return
      if (pointerFits(written, target) !== false) return // it fits, or the target that decides is unknown
      out.push({
        // C0033 is CONFIGURABLE, so the filter forces the project's own state and this severity is not what ships.
        // The recording project has it as an ERROR; the replay resolves no project settings, so the two differ by
        // configuration, not by behaviour (conformance `cc5_pointer_not_convertible`).
        severity: "warning",
        span: s.target.span,
        source: SOURCE,
        code: "pointer-not-convertible",
        message: ctx.messages.pointerNotConvertible(renderType(rhs), renderType(lhs)),
      })
    })
  }
}
