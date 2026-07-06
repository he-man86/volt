/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;`, type both sides via the
 * shared engine and flag when the compiler would refuse the implicit conversion. Thin over
 * `types/compat` + `types/infer`; conservative — any side that isn't a checkable category
 * (elementary or enum) skips, so a struct/FB/composite/library type never false-positives.
 */
import { parseStatements, walkStatements, type Expr } from "../../../syntax/index.js"
import { lookup, resolveBareEnumMember, type Scope, type Symbol } from "../../../symbols/index.js"
import { inferExprType, isAssignable, renderType, resolveMemberChain, type Type } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAssignmentTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue // body-AST is 100% on real code; a non-parsing body skips (zero-FP)

    walkStatements(parsed.statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // S=/R=/REF= have different rules
      const diag = assignmentPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
}

/**
 * The assignment-type-mismatch diagnostic for one `target := value` pair, or undefined when the compiler
 * would accept it (or either side isn't checkable). The ONE home for this rule — the ST assign check and
 * the VG sink check both call it, so the wording stays byte-identical per vendor.
 */
export function assignmentPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  const lhs = checkableType(target, scope, project)
  if (lhs === undefined) return undefined
  const rhs = checkableType(value, scope, project)
  if (rhs === undefined) return undefined
  if (isAssignable(lhs, rhs)) return undefined
  return {
    severity: "error",
    span: target.span,
    source: SOURCE,
    code: "assignment-type-mismatch",
    message: messages.cannotConvert(rhsDisplay(value, rhs), renderType(lhs)),
  }
}

/** The checkable type of an expression: elementary or enum (incl. enum-value references), else undefined. */
function checkableType(expr: Expr, scope: Scope, project: Scope): Type | undefined {
  const enumSym = enumValueRef(expr, scope, project)
  if (enumSym !== undefined) return { kind: "enum", name: enumSym.owner.name, scope: enumSym.owner }
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" || t.kind === "enum" ? t : undefined
}

/**
 * The enum-value symbol a reference denotes (bare `Red` or qualified `Color.Red`), else undefined.
 * Only a value owned by a real `enum` scope counts — an IMPLICIT/inline enum's values live in the
 * enclosing POU scope (not an enum scope), so typing them would mislabel the enum as the POU; those
 * skip (the compiler accepts inline-enum assignments, so silence is correct).
 */
function enumValueRef(expr: Expr, scope: Scope, project: Scope): Symbol | undefined {
  const sym =
    expr.kind === "ident_expr"
      ? (lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name))
      : expr.kind === "member"
        ? resolveMemberChain(expr, scope, project)
        : undefined
  return sym?.kind === "enum_value" && sym.owner.kind === "enum" ? sym : undefined
}

/**
 * The RHS type as the COMPILER renders it in the mismatch message. A string LITERAL is shown
 * length-tagged — `STRING(INT#<len>)` (`WSTRING` for `"…"`) — matching both vendors byte for byte.
 */
function rhsDisplay(value: Expr, rhs: Type): string {
  if (value.kind === "literal" && (value.literalKind === "string" || value.literalKind === "wstring")) {
    // ponytail: raw code-unit count — IEC `$`-escapes would over-count; no corpus fixture uses them.
    const inner = value.text.replace(/^['"]/, "").replace(/['"]$/, "")
    const base = value.literalKind === "wstring" ? "WSTRING" : "STRING"
    return `${base}(INT#${inner.length})`
  }
  return renderType(rhs)
}
