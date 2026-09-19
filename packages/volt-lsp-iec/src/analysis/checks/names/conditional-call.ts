/**
 * conditional-call (names/). `CALC` is the instruction-list CONDITIONAL CALL, and CODESYS's ST parser knows it:
 * it reads `CALC ( <condition> , <call statement> )` and refuses everything else, including the name used as a
 * variable. Five shapes were measured on SP21 (`cc_il_name_calc`, `ilc_calc_*`) and they share one message:
 *
 *   calc : INT;          '(' expected instead of ':'  ·  This code is not supported in declaration part  ·  …
 *   calc : STRING(8);    the SAME, so the recovery does not depend on the declared type
 *   calc := 1;           Expression expected instead of ':='  ·  …
 *   CALC(flag, n := 2);  … the second parameter is an ASSIGNMENT, not a call
 *
 *   … = Second parameter of conditional call must be a valid call statement, in every one of the five.
 *
 * A SUBSET on purpose, as the `???` instance case is. The compiler's full answer also DROPS the whole VAR section
 * a bad `calc` sits in — `Identifier 'n' not defined` and `'n' is no valid assignment target` for the declaration
 * AFTER it — and invents a `!!!'ERROR'!!!` placeholder to warn about. Reproducing a recovery that destroys
 * unrelated declarations would turn one refusal into a cascade of false positives; reporting the refusal itself
 * is the fact.
 *
 * `CALC` is why `refused-name.ts` stops at fifteen names: it alone of the IL operators parses as something, so
 * the `Unexpected token` family does not describe it. CODESYS-only — TwinCAT is unmeasured.
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../syntax/index.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const isCalc = (name: string): boolean => name.toUpperCase() === "CALC"

export function checkConditionalCall(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return
  const push = (message: string, span: { start: number; end: number }): void => {
    out.push({ severity: "error", span: span as DiagnosticItem["span"], source: SOURCE, code: "conditional-call", message })
  }

  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project))
    for (const name of decl.names)
      if (isCalc(name.text)) {
        push(ctx.messages.parenExpectedInsteadOf(":"), name.span)
        push(ctx.messages.notSupportedInDeclaration(), name.span)
        push(ctx.messages.conditionalCallSecondParameter(), name.span)
      }

  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      // The NAME used as a variable — the parser was looking for `CALC (`, and says what it found instead.
      if (s.kind === "assign" && s.target.kind === "ident_expr" && isCalc(s.target.name)) {
        push(ctx.messages.expressionExpectedInsteadOf(s.op ?? ":="), s.target.span)
        push(ctx.messages.conditionalCallSecondParameter(), s.target.span)
        return
      }
      // Written the way the parser wants it — the second parameter must then BE a call statement.
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "call" || x.callee.kind !== "ident_expr" || !isCalc(x.callee.name)) return
          const second = x.args[1]?.value
          if (second === undefined || second.kind !== "call") push(ctx.messages.conditionalCallSecondParameter(), x.callee.span)
        })
    })
}
