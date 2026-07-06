/**
 * selection-range (Layer E · E.3 · structure). At a cursor, the chain of ever-larger ranges the editor
 * expands through: token → containing expression(s) → statement → body → unit. Built from the smallest
 * spans outward so each range's `parent` strictly contains it.
 */
import type { SelectionRange } from "vscode-languageserver-protocol"
import {
  exprChildren,
  parseStatements,
  stmtChildLists,
  stmtExprs,
  walkStatements,
  type BodySpan,
  type Expr,
  type Span,
  type Statement,
  type TopLevel,
  unitBodies,
  isGraphicalBody,
} from "../../syntax/index.js"
import { isTrivia } from "../../syntax/index.js"
import { rangeFromSpan, tokenAtOffset, type Document } from "../shared/index.js"

export function selectionRange(doc: Document, offset: number): SelectionRange | undefined {
  // Collect every span that contains the offset, from the parse tree + the token.
  const spans: Span[] = []
  const tok = tokenAtOffset(doc.source, offset)
  if (tok !== undefined) spans.push(tok.span)

  for (const unit of doc.parseResult.units) {
    if (!contains(unit.span, offset)) continue
    spans.push(unit.span)
    for (const body of unitBodies(unit)) {
      if (!contains(body.span, offset) || isGraphicalBody(body)) continue
      const parsed = parseStatements(body)
      if (!parsed.ok) continue
      walkStatements(parsed.statements, (s) => collectStmt(s, offset, spans))
    }
  }
  if (spans.length === 0) return undefined

  // Dedupe + sort LARGEST-first, then fold so each node's parent is the next-larger range and the
  // returned node is the smallest (innermost) one.
  const uniq = [...new Map(spans.map((s) => [`${s.start}:${s.end}`, s])).values()].sort(
    (a, b) => b.end - b.start - (a.end - a.start),
  )
  let node: SelectionRange | undefined
  for (const span of uniq) node = { range: rangeFromSpan(span), ...(node !== undefined ? { parent: node } : {}) }
  return node
}

function collectStmt(s: Statement, offset: number, out: Span[]): void {
  if (contains(s.span, offset)) out.push(s.span)
  for (const e of stmtExprs(s)) collectExpr(e, offset, out)
  for (const list of stmtChildLists(s)) for (const sub of list) collectStmt(sub, offset, out)
}

function collectExpr(e: Expr, offset: number, out: Span[]): void {
  if (!contains(e.span, offset)) return
  out.push(e.span)
  for (const c of exprChildren(e)) collectExpr(c, offset, out)
}

function contains(span: Span, offset: number): boolean {
  return offset >= span.start && offset <= span.end
}
