/**
 * signature-help (Layer E · E.3 · assist). Inside a call `f(| … )`, shows the callee's signature and
 * highlights the active parameter. Finds the innermost enclosing call at the cursor, resolves the
 * callee to a callable symbol, and renders its VAR_INPUT parameters.
 */
import type { SignatureHelp, SignatureInformation } from "vscode-languageserver-protocol"
import { isGraphicalBody, parseStatements, unitBodies, walkAllExprs, type CallExpr } from "../../syntax/index.js"
import { scopeForUnit, type Scope } from "../../symbols/index.js"
import { renderTypeExpr, resolveCallee } from "../../types/index.js"
import { spanContains, type Document } from "../shared/index.js"

export function signatureHelp(doc: Document, project: Scope, offset: number): SignatureHelp | undefined {
  for (const unit of doc.parseResult.units) {
    if (!spanContains(unit.span, offset)) continue
    const scope = scopeForUnit(project, unit) ?? project
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body) || !spanContains(body.span, offset)) continue
      const parsed = parseStatements(body)
      if (!parsed.ok) continue
      const call = innermostCallAt(parsed.statements, offset)
      if (call === undefined) continue
      const callee = resolveCallee(call, scope, project)
      if (callee === undefined || callee.params.length === 0) return undefined
      const labels = callee.params.map((p) => `${p.name.text} : ${renderTypeExpr(p.type)}`)
      const sig: SignatureInformation = {
        label: `${callee.sym.name}(${labels.join(", ")})`,
        parameters: labels.map((l) => ({ label: l })),
      }
      return { signatures: [sig], activeSignature: 0, activeParameter: activeParam(call, offset) }
    }
  }
  return undefined
}

/** The innermost call whose argument region (after the callee) contains the offset. */
function innermostCallAt(statements: Parameters<typeof walkAllExprs>[0], offset: number): CallExpr | undefined {
  let best: CallExpr | undefined
  walkAllExprs(statements, (e) => {
    if (e.kind !== "call") return
    if (offset <= e.callee.span.end || offset > e.span.end) return // cursor must be inside the parens
    if (best === undefined || e.span.end - e.span.start < best.span.end - best.span.start) best = e
  })
  return best
}

function activeParam(call: CallExpr, offset: number): number {
  const idx = call.args.findIndex((a) => offset <= a.span.end)
  return idx < 0 ? Math.max(0, call.args.length - 1) : idx
}
