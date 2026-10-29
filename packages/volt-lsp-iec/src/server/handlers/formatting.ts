/**
 * THE FORMATTING HANDLERS — the whole document, a range, and format-on-type.
 */
import {
  DocumentFormattingRequest,
  DocumentOnTypeFormattingRequest,
  DocumentRangeFormattingRequest,
} from "vscode-languageserver-protocol/node"
import { splitLines } from "../../frontend/syntax/index.js"
import { formatDocument, formatOnType, formatRange } from "../../services/index.js"
import type { ServerState } from "../state.js"

export function registerFormattingHandlers(s: ServerState): void {
  s.onRequest(DocumentFormattingRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => {
      // every line end the client counts, a lone CR too — an end short of the last line left its text behind the edit
      const lineCount = splitLines(d.source).length
      // one whole-document edit spanning [0,0]..[lineCount,0]
      return [
        {
          range: { start: { line: 0, character: 0 }, end: { line: lineCount, character: 0 } },
          newText: formatDocument(d, p.options),
        },
      ]
    }),
  )
  s.onRequest(DocumentRangeFormattingRequest.type, (p) =>
    s.whole(p.textDocument.uri, (d) => formatRange(d, p.range, p.options)),
  )
  // Format-on-type: indent the new line to its block's depth — never a reprint of the unit around it.
  s.onRequest(DocumentOnTypeFormattingRequest.type, (p) => s.whole(p.textDocument.uri, (d) => formatOnType(d, p.position, p.ch, p.options)))
}
