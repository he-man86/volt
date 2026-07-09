/**
 * statement-rules (flow/) — body-statement rules:
 *   C0018 not-assignment-target — assigning to a target that can't be written; the zero-FP slice is a
 *          `VAR CONSTANT` (constancy === "constant") — other invalid targets (THIS^, literals) are left alone.
 *   C0509 multiple-assignment-new — `__NEW` on the RHS of a chained (multiple) assignment (`a := b := __NEW(…)`).
 *   C0132 exit-outside-loop     — an `EXIT` with no enclosing FOR/WHILE/REPEAT.
 */
import { walkStatements, stmtChildLists, type StatementList } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { constancyOf } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkStatementRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign") return
      // C0018 — writing to a constant.
      if (s.target.kind === "ident_expr" && constancyOf(s.target, scope) === "constant")
        out.push({
          severity: "error",
          span: s.target.span,
          source: SOURCE,
          code: "not-assignment-target",
          message: ctx.messages.notAssignmentTarget(ctx.source.slice(s.target.span.start, s.target.span.end)),
        })
      // C0509 — __NEW in a chained assignment.
      if (s.chained !== undefined && s.chained.length > 0 && s.value.kind === "call" && s.value.callee.kind === "ident_expr" && s.value.callee.name.toUpperCase() === "__NEW")
        out.push({ severity: "error", span: s.value.span, source: SOURCE, code: "multiple-assignment-new", message: ctx.messages.multipleAssignmentNew() })
    })
    // C0132 — EXIT outside any loop.
    exitOutsideLoop(statements, false, ctx, out)
  }
}

function exitOutsideLoop(list: StatementList, inLoop: boolean, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const s of list) {
    if (s.kind === "exit" && !inLoop)
      out.push({ severity: "error", span: s.span, source: SOURCE, code: "exit-outside-loop", message: ctx.messages.noEnclosingLoop() })
    const opensLoop = s.kind === "for" || s.kind === "while" || s.kind === "repeat"
    for (const sub of stmtChildLists(s)) exitOutsideLoop(sub, inLoop || opensLoop, ctx, out)
  }
}
