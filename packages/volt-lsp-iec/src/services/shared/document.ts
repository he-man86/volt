/**
 * A parsed source document — its identity, its text and its parse: what every language service and the server work
 * on. It lived in `services/shared/resolve-at.ts`, so the network layer and the server imported the services layer for
 * a type (consolidate-lsp-structure C1); then in the syntax layer, which knows no documents — a parse is the front-end's,
 * the document around it is its consumers' (openspec frontend-conformance P5, 1.7).
 */
import type { ParseResult } from "../../frontend/syntax/index.js"

export interface Document {
  uri: string
  source: string
  parseResult: ParseResult
}
