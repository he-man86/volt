/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;`, type both sides via the
 * shared engine and flag when the compiler would refuse the implicit conversion. Thin over
 * `types/compat` + `types/infer`; conservative — any side that isn't a checkable category
 * (elementary or enum) skips, so a struct/FB/composite/library type never false-positives.
 */
import { decodeStringLiteral, walkStatements, type Expr, type Span } from "../../../syntax/index.js"
import { bodies, lookup, resolveBareEnumMember, type Scope, type Symbol } from "../../../symbols/index.js"
import {
  inferExprType,
  isAssignable,
  literalCheckType,
  renderType,
  resolveMemberChain,
  resolveTypeExpr,
  type Type,
} from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAssignmentTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // S=/R=/REF= have different rules
      const diag = assignmentPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
  // A declaration's initial value converts like an assignment: `b : BYTE := 300` is "Cannot convert type 'INT' to type
  // 'BYTE'" (conformance `overflow_byte_above_max`). Only the measured shape — an untyped integer literal — is checked
  // here; any other initializer is unmeasured (tasks.md gap 14) and stays silent.
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = resolveTypeExpr(decl.type, ctx.project)
    if (literalCheckType(decl.init, lhs) === undefined) continue
    const diag = conversionError(lhs, decl.init, decl.init.span, scope, ctx.project, ctx.messages)
    if (diag !== undefined) out.push(diag)
  }
}

/**
 * The assignment-type-mismatch diagnostic for one `target := value` pair, or undefined when the compiler
 * would accept it (or either side isn't checkable). The ONE home for this rule — the ST assign check and
 * the network-text sink check both call it, so the wording stays byte-identical per vendor.
 */
export function assignmentPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  const lhs = checkableType(target, scope, project)
  return lhs === undefined ? undefined : conversionError(lhs, value, target.span, scope, project, messages)
}

/** The "Cannot convert" error for `value` stored into a `lhs`, reported at `span`, or undefined. An untyped integer
 *  literal the target cannot hold is typed by `literalCheckType` (gap 13); any other value by inference. */
function conversionError(lhs: Type, value: Expr, span: Span, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  const rhs = literalCheckType(value, lhs) ?? checkableType(value, scope, project)
  if (rhs === undefined) return undefined
  if (isAssignable(lhs, rhs)) return undefined
  const display = rhsDisplay(value, rhs)
  if (display === undefined) return undefined
  return {
    severity: "error",
    span,
    source: SOURCE,
    code: "assignment-type-mismatch",
    message: messages.cannotConvert(display, renderType(lhs)),
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
 * length-tagged — `STRING(INT#<len>)` (`WSTRING` for `"…"`) — matching both vendors byte for byte. The length is the
 * DECODED one: `i := 'a$Tb'` is "Cannot convert type 'STRING(INT#3)' to type 'INT'" (conformance
 * `cc_string_escape_literal_into_int`); this counted raw characters (4). A literal whose escape the shared decoder does not
 * know has no measured length — undefined, and no message.
 */
function rhsDisplay(value: Expr, rhs: Type): string | undefined {
  if (value.kind === "literal" && (value.literalKind === "string" || value.literalKind === "wstring")) {
    const wide = value.literalKind === "wstring"
    const decoded = decodeStringLiteral(value.value as string, wide)
    return decoded === undefined ? undefined : `${wide ? "WSTRING" : "STRING"}(INT#${decoded.length})`
  }
  return renderType(rhs)
}
