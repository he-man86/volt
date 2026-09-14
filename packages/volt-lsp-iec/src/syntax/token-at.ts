/**
 * The meaningful token covering a byte offset (Layer A) — for a cursor that sits in a DECLARATION (a type name, a declared
 * identifier) where there is no statement tree. It lived in `services/shared/token-scan.ts`; the network services
 * imported the services layer for it (consolidate-lsp-structure C4). ponytail: re-lexes per query (fast); no token cache
 * until profiling asks for one.
 */
import { lex } from "./lexer.js"
import { isTrivia, type Token } from "./tokens.js"

export function tokenAtOffset(source: string, offset: number): Token | undefined {
  for (const t of lex(source)) {
    if (isTrivia(t.kind) || t.kind === "eof") continue
    if (offset >= t.span.start && offset < t.span.end) return t
  }
  return undefined
}
