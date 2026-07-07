/**
 * workspace-symbol (Layer E · structure). "Go to symbol in workspace" — the project's top-level symbols
 * (FBs, functions, programs, DUTs, interfaces, GVLs, namespaces) matching a case-insensitive substring
 * query, as LSP `SymbolInformation`. Reuses the ONE `lspSymbolKind` map (no second kind table). Spans the
 * whole project because the server's eager index seeds the project `Scope` from disk, not just open docs.
 */
import type { SymbolInformation } from "vscode-languageserver-protocol"
import type { Scope } from "../../symbols/index.js"
import { lspSymbolKind, rangeFromSpan } from "../shared/index.js"

export function workspaceSymbols(project: Scope, query: string): SymbolInformation[] {
  const q = query.toLowerCase()
  const out: SymbolInformation[] = []
  for (const syms of project.symbols.values()) {
    for (const sym of syms) {
      if (q.length > 0 && !sym.name.toLowerCase().includes(q)) continue
      out.push({
        name: sym.name,
        kind: lspSymbolKind(sym.kind),
        location: { uri: sym.uri, range: rangeFromSpan(sym.declarationSpan) },
      })
    }
  }
  return out
}
