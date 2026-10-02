/**
 * statement-rules (flow/) — body-statement rules:
 *   C0018 not-assignment-target — assigning to a target that can't be written: a `VAR CONSTANT` (constancy ===
 *          "constant"), and a target that is NO NAME — a literal or an operation — echoed as the compiler echoes an
 *          expression: a chain's inner target (`out := 1 := a;` "'1' …", `out := 1 + a := 2;` "'(INT#1 + a)' …") and a
 *          FOR control variable (`FOR 1 := 1 TO 3 DO`) — `stmt_chain_literal_inner_target`, `expr_inline_assign_operand`,
 *          `stmt_for_literal_control`, both vendors 2026-10-02; a negation too, "'(INT#0 - a)' …"
 *          (`stmt_chain_negated_inner_target`, `stmt_for_negated_control`, review 2.6). (At a statement's START a literal never gets here: the
 *          parser refuses it, `stmt_assign_literal_target`.) THIS^ and the other holes are `unknown-source`'s.
 *   for-control-type — a FOR counts in an integer: a REAL or a BOOL control variable is "Cannot convert type 'REAL' to
 *          type 'ANY_INT'" (`stmt_for_real_control`, `stmt_for_bool_control`, both vendors 2026-10-02); a DWORD counts
 *          (`stmt_for_dword_control`, it runs). Only those two families are measured; `isCountingType` says which.
 *   C0509 multiple-assignment-new — `__NEW` on the RHS of a chained (multiple) assignment (`a := b := __NEW(…)`).
 *   C0132 exit-outside-loop     — an `EXIT` or a `CONTINUE` with no enclosing FOR/WHILE/REPEAT. The compiler names
 *          the statement: "No enclosing loop of which to exit" / "…of which to continue" (conformance
 *          `cc2_exit_outside_loop`, which records both).
 */
import { walkStatements, stmtChildLists, type Expr, type StatementList } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import { constancyOf, inferExprType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { compilerExprText } from "../../expr-echo.js"
import { isRefusedCounter } from "../../rules.js"

export function checkStatementRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const noName = (target: Expr): void => {
      if (!isNoName(target)) return
      const typeOf = (e: Expr): string | undefined => {
        const t = inferExprType(e, scope, ctx.project)
        return t.kind === "elementary" ? t.name : undefined
      }
      out.push({
        severity: "error",
        span: target.span,
        source: SOURCE,
        code: "not-assignment-target",
        message: ctx.messages.notAssignmentTarget(compilerExprText(target, typeOf)),
      })
    }
    walkStatements(statements, (s) => {
      if (s.kind === "for") {
        noName(s.controlVar)
        const ct = inferExprType(s.controlVar, scope, ctx.project)
        if (ct.kind === "elementary" && isRefusedCounter(ct.elem.family))
          out.push({
            severity: "error",
            span: s.controlVar.span,
            source: SOURCE,
            code: "for-control-type",
            message: ctx.messages.cannotConvert(ct.name, "ANY_INT"),
          })
      }
      if (s.kind !== "assign") return
      noName(s.target)
      for (const inner of s.chained ?? []) noName(inner)
      // C0018 — writing to a constant.
      // …a bare name or one through the global-namespace dot, quoted as written (`expr_global_namespace_constant_target`)
      if ((s.target.kind === "ident_expr" || s.target.kind === "global_expr") && constancyOf(s.target, scope) === "constant")
        out.push({
          severity: "error",
          span: s.target.span,
          source: SOURCE,
          code: "not-assignment-target",
          message: ctx.messages.notAssignmentTarget(ctx.source.slice(s.target.span.start, s.target.span.end)),
        })
      // C0509 — __NEW in a chained assignment. CODESYS-only: live /build shows TwinCAT silently accepts it.
      if (ctx.config.vendor === "codesys" && s.chained !== undefined && s.chained.length > 0 && s.value.kind === "call" && s.value.callee.kind === "ident_expr" && s.value.callee.name.toUpperCase() === "__NEW")
        out.push({ severity: "error", span: s.value.span, source: SOURCE, code: "multiple-assignment-new", message: ctx.messages.multipleAssignmentNew() })
    })
    // C0132 — EXIT or CONTINUE outside any loop.
    exitOutsideLoop(statements, false, ctx, out)
  }
}

/** A target that is no name: a literal or an operation, binary or unary (a parenthesis looks through). */
function isNoName(e: Expr): boolean {
  if (e.kind === "paren") return isNoName(e.inner)
  // …an ADDRESS literal is a target (`%MW6 := 1;`, `lit_address_in_body`)
  return (e.kind === "literal" && e.literalKind !== "address") || e.kind === "binary" || e.kind === "unary"
}

function exitOutsideLoop(list: StatementList, inLoop: boolean, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const s of list) {
    if ((s.kind === "exit" || s.kind === "continue") && !inLoop)
      out.push({
        severity: "error",
        span: s.span,
        source: SOURCE,
        code: "exit-outside-loop",
        message: ctx.messages.noEnclosingLoop(s.kind === "exit" ? "exit" : "continue"),
      })
    const opensLoop = s.kind === "for" || s.kind === "while" || s.kind === "repeat"
    for (const sub of stmtChildLists(s)) exitOutsideLoop(sub, inLoop || opensLoop, ctx, out)
  }
}
