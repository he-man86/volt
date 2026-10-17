/**
 * THE STRUCTURE HANDLERS — document and workspace symbols, folding, selection ranges, and the semantic tokens (full,
 * range, and delta against the client's previous result, cached per document in `ServerState.semTok`).
 */
import {
  DocumentSymbolRequest,
  FoldingRangeRequest,
  SelectionRangeRequest,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node"
import {
  clampedOffset,
  diffSemanticTokens,
  documentSymbolsWithVg,
  foldingRanges,
  offsetFromPosition,
  selectionRange,
  semanticTokensData,
  semanticTokensRange,
  workspaceSymbols,
} from "../../services/index.js"
import type { ServerState } from "../state.js"

export function registerStructureHandlers(s: ServerState): void {
  s.onRequest(DocumentSymbolRequest.type, (p) => s.whole(p.textDocument.uri, documentSymbolsWithVg))
  s.onRequest(WorkspaceSymbolRequest.type, (p) => workspaceSymbols(s.project(), p.query))
  s.onRequest(FoldingRangeRequest.type, (p) => s.whole(p.textDocument.uri, foldingRanges))
  s.onRequest(SelectionRangeRequest.type, (p) => {
    const d = s.doc(p.textDocument.uri)
    if (d === undefined) return null
    return p.positions.map(
      (pos) => selectionRange(d, offsetFromPosition(d.source, pos)) ?? { range: { start: pos, end: pos } },
    )
  })
  s.onRequest(SemanticTokensRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => {
      const data = semanticTokensData(d, s.project(d.uri))
      const resultId = String(++s.semTokSeq)
      s.semTok.set(p.textDocument.uri, { resultId, data })
      return { resultId, data }
    }),
  )
  s.onRequest(SemanticTokensRangeRequest.type, (p) => {
    const d = s.doc(p.textDocument.uri)
    if (d === undefined) return null
    return semanticTokensRange(
      d,
      s.project(d.uri),
      clampedOffset(d.source, p.range.start),
      clampedOffset(d.source, p.range.end),
    )
  })
  s.onRequest(SemanticTokensDeltaRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => {
      const data = semanticTokensData(d, s.project(d.uri))
      const resultId = String(++s.semTokSeq)
      const prev = s.semTok.get(p.textDocument.uri)
      s.semTok.set(p.textDocument.uri, { resultId, data })
      // Diff against the client's prior result if it's the one we cached; else fall back to a full set.
      return prev !== undefined && prev.resultId === p.previousResultId
        ? { resultId, edits: diffSemanticTokens(prev.data, data) }
        : { resultId, data }
    }),
  )
}
