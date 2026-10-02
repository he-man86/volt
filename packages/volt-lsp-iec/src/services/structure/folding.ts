/**
 * folding-range (Layer E · E.3 · structure). Foldable regions: each top-level unit, each VAR section,
 * and each multi-line block statement (IF/CASE/FOR/WHILE/REPEAT) in a POU body. Pure AST/structure.
 */
import type { FoldingRange } from "vscode-languageserver-protocol"
import { isGraphicalBody, isStBody, sourceStatements, type Span, unitBodies, walkStatements } from "../../frontend/syntax/index.js"
import { STRUCTURE_ONLY, parseNetworkText } from "../../network-text/parser.js"
import type { Document } from "../shared/index.js"

export function foldingRanges(doc: Document): FoldingRange[] {
  const out: FoldingRange[] = []
  const add = (span: Span) => {
    if (span.endLine > span.startLine) out.push({ startLine: span.startLine - 1, endLine: span.endLine - 1 })
  }
  for (const unit of doc.parseResult.units) {
    add(unit.span)
    if ("varSections" in unit) for (const s of unit.varSections) add(s.span)
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) {
        for (const n of parseNetworkText(body, STRUCTURE_ONLY, doc.parseResult.dialect).networks) add(n.span) // one fold per NETWORK in an FBD/LD body
        continue
      }
      if (!isStBody(body)) continue // a hidden body is empty: nothing to fold
      const parsed = sourceStatements(body) // as written: a branch not taken folds too
      if (!parsed.ok) continue
      walkStatements(parsed.statements, (s) => {
        if (s.kind === "if" || s.kind === "case" || s.kind === "for" || s.kind === "while" || s.kind === "repeat") {
          add(s.span)
        }
      })
    }
  }
  return out
}
