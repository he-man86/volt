/**
 * VG outline (Layer F, F.2) — the graphical branch of document-symbol. Enriches the ST outline (E's
 * `documentSymbols`) with a `NETWORK n` child under each POU that has a graphical body, so an FBD/LD
 * body shows its networks instead of appearing empty.
 */
import { SymbolKind, type DocumentSymbol } from "vscode-languageserver-protocol"
import { unitBodies, isGraphicalBody } from "../syntax/index.js"
import { documentSymbols, rangeFromSpan, type Document } from "../services/index.js"
import { parseVgBody } from "./text/parser.js"

/** ST document symbols with each VG body's networks attached under their owning POU. */
export function documentSymbolsWithVg(doc: Document): DocumentSymbol[] {
  const symbols = documentSymbols(doc)
  for (const unit of doc.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (!isGraphicalBody(body)) continue
      const networks = parseVgBody(body).networks.map(
        (n): DocumentSymbol => ({
          name: `NETWORK ${n.index ?? "?"}${n.label ? `: ${n.label}` : ""}`,
          kind: SymbolKind.Namespace,
          range: rangeFromSpan(n.span),
          selectionRange: rangeFromSpan(n.headerSpan),
        }),
      )
      if (networks.length === 0) continue
      // Span lines are 1-based; LSP ranges 0-based → shift by 1. The body lives inside its owning POU.
      const line = body.span.startLine - 1
      const owner = symbols.find((s) => s.range.start.line <= line && line <= s.range.end.line)
      if (owner) (owner.children ??= []).push(...networks)
    }
  }
  return symbols
}
