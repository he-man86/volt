/**
 * type-as-value (C0230 · names/). A DUT type name used where a value is expected — as an assignment target or
 * value (`value := MyEnum`, `MyEnum := value`).
 *
 * Zero-FP: only a BARE identifier resolving to a `type` symbol (a DUT: enum/struct/alias) in the assignment's
 * target/value slot fires. `MyEnum.RED` is a member (not a bare ident) and `SIZEOF(MyEnum)` is a call argument,
 * so both are naturally excluded. FB/interface type names have their own codes (C0080/C0199).
 */
import { walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, lookup, type Scope } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkTypeAsValue(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign") return
      flagIfType(s.target, scope, ctx, out)
      flagIfType(s.value, scope, ctx, out)
    })
  }
}

function flagIfType(e: Expr, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (e.kind !== "ident_expr" || lookup(scope, e.name)?.symbol.kind !== "type") return
  out.push({
    severity: "error",
    span: e.span,
    source: SOURCE,
    code: "type-name-as-value",
    message: ctx.messages.typeNameNotExpected(e.name),
  })
}
