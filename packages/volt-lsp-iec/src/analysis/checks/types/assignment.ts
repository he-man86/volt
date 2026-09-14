/**
 * assignment-type-mismatch (D.2 · types/). For each `target := value;`, type both sides via the
 * shared engine and flag when the compiler would refuse the implicit conversion. Thin over
 * `types/compat` + `types/infer`; conservative — any side that isn't a checkable category
 * (elementary or enum) skips, so a struct/FB/composite/library type never false-positives.
 */
import { decodeStringLiteral, walkStatements, type Expr, type Span } from "../../../syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../symbols/index.js"
import { isAssignable, literalErrorType, resolveTypeExpr, type Type } from "../../../types/index.js"
import { compilerStringLiteralText, compilerTypeName, type Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { checkable, checkableType, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAssignmentTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // S=/R=/REF= have different rules
      const diag = assignmentPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
  // A declaration's initial value converts like an assignment — the same rule, recorded for every literal shape
  // (conformance `cc_init_*`: `i : INT := TRUE` is "Cannot convert type 'BOOL' to type 'INT'", `si : SINT := INT#5` INT to
  // SINT, `si : SINT := 100 + 100` silent). Initializers were never type-checked at all (gap 14).
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = checkable(resolveTypeExpr(decl.type, ctx.project))
    if (lhs === undefined) continue // a composite target is not this check's
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

/** The "Cannot convert" error for `value` stored into a `lhs`, reported at `span`, or undefined. An untyped numeric
 *  literal is typed by `literalErrorType` (gaps 13, 14); any other value by inference. */
function conversionError(lhs: Type, value: Expr, span: Span, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  const rhs = literalErrorType(value, lhs) ?? checkableType(value, scope, project)
  if (rhs === undefined) return undefined
  if (isAssignable(lhs, rhs)) return undefined
  const display = rhsDisplay(value, rhs)
  if (display === undefined) return undefined
  return {
    severity: "error",
    span,
    source: SOURCE,
    code: "assignment-type-mismatch",
    message: messages.cannotConvert(display, compilerTypeName(lhs)),
  }
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
    return decoded === undefined ? undefined : compilerStringLiteralText(decoded.length, wide)
  }
  return compilerTypeName(rhs)
}
