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
 *   for-bound-type — a FOR limit or step that does not convert into the counter: "Cannot convert type 'DINT' to type
 *          'INT'" (`refusedBound`; lsp-transpile-review-gaps 1.1, 1.2, 2.1).
 *   C0509 multiple-assignment-new — `__NEW` on the RHS of a chained (multiple) assignment (`a := b := __NEW(…)`).
 *   C0132 exit-outside-loop     — an `EXIT` or a `CONTINUE` with no enclosing FOR/WHILE/REPEAT. The compiler names
 *          the statement: "No enclosing loop of which to exit" / "…of which to continue" (conformance
 *          `cc2_exit_outside_loop`, which records both).
 */
import { walkStatements, stmtChildLists, type Expr, type StatementList } from "../../../frontend/syntax/index.js"
import { bodies, lookup, type Scope } from "../../../frontend/symbols/index.js"
import { classifyConversion, constancyOf, constEval, inferExprType, integerLiteralType, renderType, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { compilerExprText } from "../../shared/expr-echo.js"
import { isRefusedCounter } from "../../shared/rules.js"

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
        for (const bound of [s.to, s.by]) {
          const refused = bound === undefined ? undefined : refusedBound(ct, bound, bound === s.by, scope, ctx.project)
          if (refused !== undefined)
            out.push({ severity: "error", span: bound!.span, source: SOURCE, code: "for-bound-type", message: ctx.messages.cannotConvert(refused, renderType(ct, { form: "compiler" })) })
        }
      }
      if (s.kind !== "assign") return
      noName(s.target)
      for (const inner of s.chained ?? []) noName(inner)
      // C0018 — writing to a constant.
      // …a bare name or one through the global-namespace dot, quoted as written (`expr_global_namespace_constant_target`)
      // …not a VAR_INPUT CONSTANT, which the body writes without a word from either vendor (`flw_assign_input_constant`,
      // analysis-conformance 3.9, 2026-10-06)
      const inputConstant = s.target.kind === "ident_expr" && lookup(scope, s.target.name)?.symbol.varSection === "VAR_INPUT"
      if ((s.target.kind === "ident_expr" || s.target.kind === "global_expr") && !inputConstant && constancyOf(s.target, scope) === "constant")
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

/**
 * The type a FOR limit or step is refused as, or undefined when it converts into the counter. A bound is judged by its
 * front-end TYPE (`classifyConversion` `incompatible`): a DINT variable, expression, UPPER_BOUND, named CONSTANT or typed
 * literal on an INT counter is "Cannot convert type 'DINT' to type 'INT'" (`for_limit_wider_than_counter_*`,
 * `for_step_wider_than_counter_dint_paren`, `_upper_bound`, `for_step_typed_literal_on_narrower_counter`,
 * `tr_35_for_byte_runtime_int_step`). A same-width sign change converts (`for_limit_sign_change_*`), and an expression of
 * untyped literals has no named type (`callshape_for_runtime_step`). A STEP that folds is also asked by VALUE: it fits
 * the counter, or is a negative one an unsigned counter's signed twin holds (`tr_35_for_byte_step_minus_one`, `_255`);
 * otherwise it is refused as its literal type (`tr_35_for_sint_step_300`: 300 on a SINT is 'INT'). The LIMIT is not:
 * `TO 200` on a SINT is taken (`tr_36_for_literal_limit_beyond_counter`). The transpiler's twin is `lower/statements/loops.ts`.
 */
function refusedBound(counter: Type, bound: Expr, isStep: boolean, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(bound, scope, project)
  if (classifyConversion(counter, t) === "incompatible") return renderType(t, { form: "compiler" })
  const e = counter.kind === "elementary" ? counter.elem : undefined
  if (!isStep || e?.range === undefined) return undefined
  const v = constEval(bound, scope)
  if (typeof v !== "bigint") return undefined
  if ((v >= e.range.min && v <= e.range.max) || (!e.signed && v < 0n && BigInt.asIntN(e.bits, v) === v)) return undefined
  const own = integerLiteralType(v)
  return own === undefined ? undefined : own.name
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
