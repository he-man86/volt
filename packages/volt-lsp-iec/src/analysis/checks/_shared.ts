/**
 * Shared utilities for the per-check modules under `analysis/checks/`. The underscore marks
 * "internal to the checks tree". `DiagnosticItem` lives here (a leaf) so the orchestrator and every
 * check import it without a cycle.
 */
import { type Expr, type Span } from "../../syntax/index.js"
import { type Scope } from "../../symbols/index.js"
import { classifyConversion, elemOf, inferExprType, type Type } from "../../types/index.js"
import { compilerTypeName, type Messages } from "../messages.js"

export interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span
  source: string
  code: string
  message: string
}

/** Source tag on every DiagnosticItem this LSP emits. */
export const SOURCE = "volt-lsp-iec"

/** A type a conversion check can decide — elementary or enum — else undefined (a struct, FB, array or unknown type). */
export function checkable(t: Type): Type | undefined {
  return t.kind === "elementary" || t.kind === "enum" ? t : undefined
}

/**
 * An expression's checkable type — the ONE the assignment, narrowing and call-argument checks share. Inference types an
 * enum value as its enum, so there is no enum lookup here: each of those checks kept its own, and the call-argument copy
 * never learned an enum's base type (consolidate-lsp-structure B6).
 */
export function checkableType(expr: Expr, scope: Scope, project: Scope): Type | undefined {
  return checkable(inferExprType(expr, scope, project))
}

/**
 * Map a source→value conversion to its narrowing / change-of-sign WARNING on `at`, or undefined. The ONE mapping —
 * the assignment pair and conversion-argument checks (types/narrowing.ts), the negation operand, and the
 * call-argument check (calls/call-arguments.ts) all funnel through it, so the wording stays byte-identical.
 *
 * It lives here, not in narrowing.ts, because two check groups share it: `call-arguments.ts` imported it from its
 * sibling `narrowing.ts`, which the layering rule forbids — and that lint had been red, unnoticed, since 2026-09-06,
 * because CI is advisory and nothing else runs it.
 */
export function conversionWarning(lhs: Type, rhs: Type, at: Expr, messages: Messages): DiagnosticItem | undefined {
  const kind = classifyConversion(lhs, rhs)
  if (kind === "narrow") return conversionWarn(at, "narrowing-conversion", messages.narrowing(compilerTypeName(rhs), compilerTypeName(lhs)))
  if (kind === "sign-change")
    return conversionWarn(
      at,
      "sign-change-conversion",
      messages.signChange(signOf(rhs), compilerTypeName(rhs), signOf(lhs), compilerTypeName(lhs)),
    )
  return undefined
}

const conversionWarn = (target: Expr, code: string, message: string): DiagnosticItem => ({
  severity: "warning",
  span: target.span,
  source: SOURCE,
  code,
  message,
})

function signOf(t: Type): string {
  // the facts ride on the Type — no second lookup by name (consolidate-lsp-structure B1); an enum signs as its base
  return elemOf(t.kind === "enum" && t.base !== undefined ? t.base : t)?.signed ? "signed" : "unsigned"
}

// `isLibrarySymbol` moved to the symbols layer (B) so types (const-eval/infer) reach the SAME normalized
// predicate — re-exported here so analysis callers keep importing it from `_shared`. See its doc in symbol.ts.
export { isLibrarySymbol } from "../../symbols/index.js"
