/**
 * navigation (Layer E · E.2) — definition · type-definition, routed through `shared/resolveAt` (one resolution). References,
 * highlight and rename are `network/network-services`'s `*Anywhere`: one path for ST and network text, over the type-aware
 * `findReferences` (one occurrence set) — the ST-only copies here had no caller but their tests (lsp-same-standard 3.1).
 */
import type { Location } from "vscode-languageserver-protocol"
import { lookup, type Scope } from "../../frontend/symbols/index.js"
import { locationOf, resolveAt } from "../shared/index.js"
import type { Document } from "../shared/index.js"

/** Go-to-definition: the defining location of the symbol under the cursor. */
export function definition(doc: Document, project: Scope, offset: number): Location | undefined {
  const sym = resolveAt(doc, project, offset)
  return sym !== undefined ? locationOf(sym) : undefined
}

/** Go-to-type-definition: the declaration of the symbol's TYPE (`x : FB_A` → FB_A). */
export function typeDefinition(doc: Document, project: Scope, offset: number): Location | undefined {
  const te = resolveAt(doc, project, offset)?.typeExpr
  if (te === undefined) return undefined
  const name =
    te.kind === "named_type"
      ? te.name.text
      : te.kind === "array_type" && te.element.kind === "named_type"
        ? te.element.name.text
        : undefined
  if (name === undefined) return undefined
  const typeSym = lookup(project, name)?.symbol
  return typeSym !== undefined ? locationOf(typeSym) : undefined
}
