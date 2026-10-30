/**
 * references · highlights · rename at a cursor — the symbol resolved where the cursor stands, every occurrence found by
 * `findReferences`. A network body is ST (`syntax/network/plain-st.ts`), so its wires and operands are found the same way.
 */
import type { Location, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol"
import { isRefusedDeclaredName, isTrivia, lex } from "../../frontend/syntax/index.js"
import { dialectOf, isLibrarySymbol, type Scope, type Symbol } from "../../frontend/symbols/index.js"
import { rangeFromSpan, resolveAt, tokenAtOffset, type Document } from "../shared/index.js"
import { libraryMembersOf, overrideChain } from "./override-chain.js"
import { findReferences, toLocations } from "./references.js"

/** references — the target resolved at the cursor; its declaration kept unless `includeDeclaration` is false. */
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
          !(r.uri === sym.uri && r.range.start.line === sym.span.startLine - 1 && r.range.start.character === sym.span.startCol),
      )
  return toLocations(kept)
}

/** documentHighlight — every occurrence of the cursor's symbol IN this doc. */
export function documentHighlights(doc: Document, project: Scope, offset: number): Range[] | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined) return undefined
  return findReferences([doc], project, sym).map((r) => r.range)
}

/** The symbol a rename at the cursor renames: one the project declares. A library element is a read-only materialization
 *  under `Library Manager/` whose name is the library's — renamed, the project would name an element no library has. */
function renameTarget(doc: Document, project: Scope, offset: number): Symbol | undefined {
  const sym = resolveAt(doc, project, offset)
  return sym === undefined || isLibrarySymbol(sym) ? undefined : sym
}

/**
 * Why `newName` cannot be a rename's new name in the project's dialect, or undefined when it can: it must lex as ONE
 * identifier (no keyword, no literal, nothing around it) the dialect's declarations accept (`isRefusedDeclaredName`: no
 * type or IL word, no `__`). Written over every occurrence, anything else leaves a project the compiler refuses.
 */
export function renameRefusal(newName: string, project: Scope, unicodeIdentifiers: boolean): string | undefined {
  const dialect = dialectOf(project)
  const tokens = lex(newName, dialect, unicodeIdentifiers).filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
  const one = tokens.length === 1 && tokens[0]!.kind === "identifier" && tokens[0]!.text === newName
  return one && !isRefusedDeclaredName(newName, dialect) ? undefined : `'${newName}' is no name a declaration accepts`
}

/**
 * Why the member at the cursor cannot be renamed although it is the project's: its OVERRIDE CHAIN reaches a library's
 * member (`override-chain`, design.md §6 B6) — the project's override would no longer match a name no project edit can
 * change. Undefined when it can be renamed, or is no such member.
 */
export function renameChainRefusal(doc: Document, project: Scope, offset: number): string | undefined {
  const sym = renameTarget(doc, project, offset)
  if (sym === undefined) return undefined
  const library = libraryMembersOf(project, sym)
  if (library.length === 0) return undefined
  return `'${sym.name}' overrides or implements the library member ${library.map((m) => `'${m.owner.name}.${m.name}'`).join(", ")}, which no project edit can rename`
}

/** prepareRename — the editable range for a renameable cursor. */
export function prepareRename(doc: Document, project: Scope, offset: number): Range | undefined {
  if (renameTarget(doc, project, offset) === undefined) return undefined
  const tok = tokenAtOffset(doc.parseResult.tokens, offset)
  return tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword") ? rangeFromSpan(tok.span) : undefined
}

/** rename — one edit per occurrence; a METHOD or PROPERTY renames with every member it overrides or implements, or that
 *  overrides or implements it (B6). */
export function rename(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
  newName: string,
): WorkspaceEdit | undefined {
  const sym = renameTarget(doc, project, offset)
  if (sym === undefined || renameChainRefusal(doc, project, offset) !== undefined) return undefined
  const changes: Record<string, TextEdit[]> = {}
  const seen = new Set<string>()
  for (const r of findReferences(docs, project, overrideChain(project, sym))) {
    const key = `${r.uri}#${r.range.start.line}:${r.range.start.character}-${r.range.end.line}:${r.range.end.character}`
    if (seen.has(key)) continue
    seen.add(key)
    ;(changes[r.uri] ??= []).push({ range: r.range, newText: newName })
  }
  return { changes }
}
