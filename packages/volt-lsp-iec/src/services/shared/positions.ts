/**
 * Position math (Layer E · shared). Converts between our `Span` (1-based line / 0-based col + byte
 * offsets) and LSP `Range`/`Position` (0-based). ponytail: `Position.character` is treated as a byte
 * offset — correct for ASCII ST code (practically all PLC source); revisit only for multibyte identifiers.
 */
import type { Position, Range } from "vscode-languageserver-protocol"
import {
  isTrivia,
  walkAllExprs,
  type Expr,
  type MemberExpr,
  type Span,
  type StatementList,
  type Token,
} from "../../frontend/syntax/index.js"

export function rangeFromSpan(span: Span): Range {
  return {
    start: { line: span.startLine - 1, character: span.startCol },
    end: { line: span.endLine - 1, character: span.endCol },
  }
}

/** LSP position → byte offset in `src`, or -1 if out of range. */
export function offsetFromPosition(src: string, pos: Position): number {
  let line = 0
  let col = 0
  for (let i = 0; i < src.length; i++) {
    if (line === pos.line && col === pos.character) return i
    if (src[i] === "\n") {
      line += 1
      col = 0
    } else {
      col += 1
    }
  }
  return line === pos.line && col === pos.character ? src.length : -1
}

/**
 * The meaningful token covering a byte offset — for a cursor that sits in a DECLARATION (a type name, a declared
 * identifier) where there is no statement tree. It lived in `services/shared/token-scan.ts`, then in the syntax layer
 * (`token-at.ts`); the syntax layer answers what text IS, and a cursor is a service's question (openspec
 * frontend-conformance P5, 1.10). It reads the tokens the PARSE lexed, in the document's dialect: it re-lexed the
 * source as CODESYS, so on TwinCAT a `__POSITION` under the cursor was a keyword the vendor does not have (2.1.4).
 */
export function tokenAtOffset(tokens: readonly Token[], offset: number): Token | undefined {
  for (const t of tokens) {
    if (isTrivia(t.kind) || t.kind === "eof") continue
    if (offset >= t.span.start && offset < t.span.end) return t
  }
  return undefined
}

/** The innermost expression node whose span covers `offset` (smallest span wins). */
export function exprAtOffset(list: StatementList, offset: number): Expr | undefined {
  let best: Expr | undefined
  walkAllExprs(list, (e) => {
    if (offset >= e.span.start && offset < e.span.end) {
      if (best === undefined || e.span.end - e.span.start < best.span.end - best.span.start) best = e
    }
  })
  return best
}

/** The member-access node whose MEMBER name (`.b` in `a.b`) covers `offset` — the node to resolve for
 *  member-chain navigation when the cursor is on a member. */
export function memberAtOffset(list: StatementList, offset: number): MemberExpr | undefined {
  let hit: MemberExpr | undefined
  walkAllExprs(list, (e) => {
    if (e.kind === "member" && offset >= e.member.span.start && offset < e.member.span.end) hit = e
  })
  return hit
}
