/**
 * type-as-value (C0230 · names/). A DUT type name used where a value is expected — as an assignment target or
 * value (`value := MyEnum`, `MyEnum := value`) — and a STRUCT type's name called (`S()`) or reached into for a member it
 * does not declare (`S.nope`): "Type name 'S' not expected in this place" (`dt_struct_type_name_called`,
 * `dt_static_base_unknown_member`, CODESYS 2026-10-03).
 *
 * Zero-FP: only a BARE identifier resolving to a `type` symbol (a DUT: enum/struct/alias) in the assignment's
 * target/value slot fires, and a STRUCT's in the two recorded shapes. `MyEnum.RED` is a member (not a bare ident) and
 * `SIZEOF(MyEnum)` is a call argument, so both are naturally excluded. FB/interface type names have their own codes
 * (C0080/C0199).
 */
import { walkAllExprs, walkStatements, type Expr, type TypeDecl } from "../../../frontend/syntax/index.js"
import { bodies, lookup, lookupMember, type Scope } from "../../../frontend/symbols/index.js"
import { inferExprType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkTypeAsValue(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign") return
      flagIfType(s.target, scope, ctx, out)
      flagIfType(s.value, scope, ctx, out)
    })
    walkAllExprs(statements, (e) => {
      if (e.kind === "call" && isStructTypeName(e.callee, scope)) flag(e.callee, ctx, out)
      else if (e.kind === "member" && isStructTypeName(e.base, scope)) {
        const base = inferExprType(e.base, scope, ctx.project)
        if (base.kind === "static" && base.scope !== undefined && lookupMember(base.scope, e.member.name) === undefined) flag(e.base, ctx, out)
      }
    })
  }
}

function flagIfType(e: Expr, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (e.kind === "ident_expr" && lookup(scope, e.name)?.symbol.kind === "type") flag(e, ctx, out)
}

/** Is `e` a bare name resolving to a STRUCT type? */
function isStructTypeName(e: Expr, scope: Scope): e is Extract<Expr, { kind: "ident_expr" }> {
  if (e.kind !== "ident_expr") return false
  const sym = lookup(scope, e.name)?.symbol
  return sym?.kind === "type" && (sym.ast as TypeDecl).body.kind === "struct"
}

function flag(e: Extract<Expr, { kind: "ident_expr" }>, ctx: CheckContext, out: DiagnosticItem[]): void {
  out.push({ severity: "error", span: e.span, source: SOURCE, code: "type-name-as-value", message: ctx.messages.typeNameNotExpected(e.name) })
}
