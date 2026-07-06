/**
 * folding-range (Layer E · E.3 · structure). Foldable regions: each top-level unit, each VAR section,
 * and each multi-line block statement (IF/CASE/FOR/WHILE/REPEAT) in a POU body. Pure AST/structure.
 */
import type { FoldingRange } from "vscode-languageserver-protocol"
import {
  parseStatements,
  walkStatements,
  type BodySpan,
  type Span,
  type TopLevel,
  unitBodies,
  isGraphicalBody,
} from "../../syntax/index.js"
import { isTrivia } from "../../syntax/index.js"
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
      if (isGraphicalBody(body)) continue
      const parsed = parseStatements(body)
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
