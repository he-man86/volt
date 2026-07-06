/**
 * hover (Layer E · E.3 · assist). A markdown tooltip for the symbol under the cursor: a reconstructed
 * declaration line in an `iecst` code fence + the human kind label (the same `humanKind` completion
 * uses — the parity test guards they agree). Thin over `resolveAt` + `types/renderTypeExpr`.
 * (Reference-catalog hover for built-ins like `INT` / `{attribute}` lands with Layer F.)
 */
import type { Hover } from "vscode-languageserver-protocol"
import { lookupReference, renderReferenceHover } from "../../reference/index.js"
import type { Scope, Symbol, SymbolKind } from "../../symbols/index.js"
import { renderTypeExpr } from "../../types/index.js"
import { humanKind, rangeFromSpan, resolveAt, tokenAtOffset, type Document } from "../shared/index.js"

export function hover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const tok = tokenAtOffset(doc.source, offset)
  const range = tok !== undefined ? { range: rangeFromSpan(tok.span) } : {}

  const sym = resolveAt(doc, project, offset)
  if (sym !== undefined) return { ...symbolHover(sym), ...range }

  // Not a user symbol — a built-in (INT / MOD / SQRT / …). Fall back to the reference catalog.
  if (tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")) {
    const entry = lookupReference(tok.text)
    if (entry !== undefined) return { contents: { kind: "markdown", value: renderReferenceHover(entry) }, ...range }
  }
  return undefined
}

/** The markdown hover for a resolved symbol — a declaration line + kind label. Shared by ST and VG hover. */
export function symbolHover(sym: Symbol): Hover {
  const value = `\`\`\`iecst\n${declarationLine(sym)}\n\`\`\`\n\n_${humanKind(sym.kind)}_`
  return { contents: { kind: "markdown", value } }
}

/** Reconstruct a one-line declaration from the symbol: `name : Type` for typed things, else `KEYWORD name`. */
function declarationLine(sym: Symbol): string {
  if (sym.typeExpr !== undefined) return `${sym.name} : ${renderTypeExpr(sym.typeExpr)}`
  return `${declKeyword(sym.kind)} ${sym.name}`
}

function declKeyword(kind: SymbolKind): string {
  switch (kind) {
    case "function_block":
      return "FUNCTION_BLOCK"
    case "program":
      return "PROGRAM"
    case "function":
      return "FUNCTION"
    case "interface":
      return "INTERFACE"
    case "type":
      return "TYPE"
    case "namespace":
      return "NAMESPACE"
    case "method":
    case "interface_method":
      return "METHOD"
    case "action":
      return "ACTION"
    case "gvl_block":
      return "VAR_GLOBAL"
    default:
      return humanKind(kind).toUpperCase()
  }
}
