/**
 * code-actions (Layer E · E.3 · assist). Quick-fixes for the diagnostics the client passes back in a
 * range. Currently: a type-mismatch or narrowing on `x := y` offers "Wrap in TO_<LhsType>(…)" — the
 * explicit-conversion fix both compilers accept. Thin over `infer` + the shared `exprText` renderer.
 */
import type { CodeAction, Diagnostic } from "vscode-languageserver-protocol"
import { CodeActionKind } from "vscode-languageserver-protocol"
import { walkStatements, type Assignment } from "../../syntax/index.js"
import type { Scope } from "../../symbols/index.js"
import { exprText, inferExprType } from "../../types/index.js"
import { offsetFromPosition, rangeFromSpan, stBodies, type Document } from "../shared/index.js"

const FIXABLE = new Set(["assignment-type-mismatch", "narrowing-conversion"])

export function codeActions(doc: Document, project: Scope, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const out: CodeAction[] = []
  for (const diag of diagnostics) {
    if (typeof diag.code !== "string" || !FIXABLE.has(diag.code)) continue
    const offset = offsetFromPosition(doc.source, diag.range.start)
    const fix = offset >= 0 ? wrapConversionFix(doc, project, offset, diag) : undefined
    if (fix !== undefined) out.push(fix)
  }
  return out
}

function wrapConversionFix(doc: Document, project: Scope, offset: number, diag: Diagnostic): CodeAction | undefined {
  for (const { scope, statements } of stBodies(doc, project)) {
    let target: Assignment | undefined
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.target.span.start === offset) target = s
    })
    if (target === undefined) continue
    const lhs = inferExprType(target.target, scope, project)
    if (lhs.kind !== "elementary") return undefined
    const newText = `TO_${lhs.name}(${exprText(target.value)})`
    return {
      title: `Wrap in TO_${lhs.name}(…)`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      edit: { changes: { [doc.uri]: [{ range: rangeFromSpan(target.value.span), newText }] } },
    }
  }
  return undefined
}
