/**
 * token-scan (Layer E · shared). The meaningful token covering a byte offset — used to resolve a
 * cursor that sits in a DECLARATION (a type name, a declared identifier) where there is no statement
 * tree. ponytail: re-lexes per query (fast); no incremental token cache until profiling asks for one.
 */
import { isTrivia, lex, type Token } from "../../syntax/index.js"

export function tokenAtOffset(source: string, offset: number): Token | undefined {
  for (const t of lex(source)) {
    if (isTrivia(t.kind) || t.kind === "eof") continue
    if (offset >= t.span.start && offset < t.span.end) return t
  }
  return undefined
}
