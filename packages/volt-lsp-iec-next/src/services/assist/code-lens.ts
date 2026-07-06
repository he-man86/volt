/**
 * code-lens (Layer E · E.3 · assist). A "N references" lens above each named top-level declaration.
 * Counts via the shared type-aware `findReferences` (minus the declaration itself).
 */
import type { CodeLens } from "vscode-languageserver-protocol"
import type { Scope } from "../../symbols/index.js"
import { rangeFromSpan, resolveAt, type Document } from "../shared/index.js"
import { findReferences } from "../navigation/index.js"

export function codeLenses(docs: Iterable<Document>, project: Scope, doc: Document): CodeLens[] {
  const out: CodeLens[] = []
  for (const unit of doc.parseResult.units) {
    if (!("name" in unit)) continue
    const sym = resolveAt(doc, project, unit.name.span.start)
    if (sym === undefined) continue
    const count = findReferences(docs, project, sym).length - 1 // exclude the declaration
    out.push({
      range: rangeFromSpan(unit.name.span),
      command: { title: `${count} reference${count === 1 ? "" : "s"}`, command: "" },
    })
  }
  return out
}
