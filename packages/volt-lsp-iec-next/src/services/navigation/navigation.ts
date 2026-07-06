/**
 * navigation (Layer E · E.2) — definition · type-definition · references · document-highlight ·
 * prepare-rename · rename, ALL routed through `shared/resolveAt` (one resolution) and the type-aware
 * `findReferences` (one occurrence set). Thin by construction: each feature is a few lines.
 */
import type { Location, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol"
import { lookup, type Scope } from "../../symbols/index.js"
import { locationOf, rangeFromSpan, resolveAt, tokenAtOffset, type Document } from "../shared/index.js"
import { findReferences, toLocations } from "./references.js"

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

/** Find-references across the workspace. `includeDeclaration` toggles the defining occurrence. */
export function references(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
  includeDeclaration = true,
): Location[] | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined) return undefined
  const refs = findReferences(docs, project, sym)
  const kept = includeDeclaration
    ? refs
    : refs.filter(
        (r) =>
          !(
            r.uri === sym.uri &&
            r.range.start.line === sym.span.startLine - 1 &&
            r.range.start.character === sym.span.startCol
          ),
      )
  return toLocations(kept)
}

/** Highlight every occurrence of the symbol under the cursor within THIS document. */
export function documentHighlights(doc: Document, project: Scope, offset: number): Range[] | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined) return undefined
  return findReferences([doc], project, sym).map((r) => r.range)
}

/** The renameable range under the cursor (null-ish when nothing resolves → the client blocks rename). */
export function prepareRename(doc: Document, project: Scope, offset: number): Range | undefined {
  if (resolveAt(doc, project, offset) === undefined) return undefined
  const tok = tokenAtOffset(doc.source, offset)
  return tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")
    ? rangeFromSpan(tok.span)
    : undefined
}

/** Rename every binding of the symbol under the cursor to `newName` (type-aware — exact bindings only). */
export function rename(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
  newName: string,
): WorkspaceEdit | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined) return undefined
  const changes: Record<string, TextEdit[]> = {}
  for (const r of findReferences(docs, project, sym)) {
    ;(changes[r.uri] ??= []).push({ range: r.range, newText: newName })
  }
  return { changes }
}
