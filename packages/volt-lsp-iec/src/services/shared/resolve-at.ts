/**
 * resolve-at (Layer E · shared) — THE ONE cursor→symbol resolution semantics. Every navigation and
 * assist feature routes through `resolveAt`, so "what does the cursor point at" has a single answer.
 *
 * Order: (1) if the cursor is in an ST body, use the statement tree — a member chain resolves through
 * `types/resolveMemberChain`, a bare ident through scope lookup; (2) otherwise the cursor is in a
 * DECLARATION — return the symbol whose defining span it sits on, else resolve the token as a name/type.
 * Conservative: unresolved → undefined (a feature simply does nothing rather than guess).
 */
import {
  type Document,
  exprAtOffset,
  memberAtOffset,
  type ParseResult,
  spanContains,
  tokenAtOffset,
} from "../../syntax/index.js"
import {
  bodiesAt,
  lookup,
  resolveBareEnumMember,
  scopeForUnit,
  type Scope,
  type Symbol,
} from "../../symbols/index.js"
import { resolveMemberChain } from "../../types/index.js"

export function resolveAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  // Body path — resolve through the statement tree where the cursor sits, in the body's own scope (a property accessor's
  // for its locals; this used the unit scope, so a getter-local resolved nowhere — consolidate-lsp-structure A5).
  for (const { scope, statements } of bodiesAt(doc.parseResult.units, project, offset)) {
    const member = memberAtOffset(statements, offset)
    if (member !== undefined) {
      const sym = resolveMemberChain(member, scope, project)
      if (sym !== undefined) return sym
    }
    const expr = exprAtOffset(statements, offset)
    if (expr?.kind === "ident_expr") {
      return lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name)
    }
  }

  // Declaration path — the cursor is on a defining identifier, a type name, or a modifier.
  const onDef = symbolDefinedAt(doc, project, offset)
  if (onDef !== undefined) return onDef
  const tok = tokenAtOffset(doc.source, offset)
  if (tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")) {
    const scope = unitScopeAtOffset(doc.parseResult, project, offset)
    return lookup(scope, tok.text)?.symbol ?? resolveBareEnumMember(project, tok.text)
  }
  return undefined
}

/**
 * The scope a CURSOR sits in — a property accessor's own when the offset is inside one, the unit's otherwise.
 *
 * <p>This was a one-line delegate to `unitScopeAtOffset`, which resolves a unit and stops. That is right for the
 * DECLARATION path above (a cursor on a type name is not inside any body) and wrong here: an accessor's locals
 * live in a child scope keyed by the body span, which is exactly what `bodiesAt` finds and this did not. The A5
 * fix landed for `resolveAt`, `signatureHelp` and inlay hints, and the two consumers of THIS function —
 * completion and semantic tokens — kept the old answer. Measured: completing inside a GET that declares
 * `localGet` offered 31 items and `localGet` was not among them.</p>
 */
export function scopeAtOffset(doc: Document, project: Scope, offset: number): Scope {
  for (const b of bodiesAt(doc.parseResult.units, project, offset)) return b.scope
  return unitScopeAtOffset(doc.parseResult, project, offset)
}

function unitScopeAtOffset(parseResult: ParseResult, project: Scope, offset: number): Scope {
  for (const unit of parseResult.units) {
    if (spanContains(unit.span, offset)) return scopeForUnit(project, unit) ?? project
  }
  return project
}

/** The symbol whose DEFINING identifier span covers the offset (cursor sits on a declaration). */
// The offset is a position in ONE document, so a symbol defined at it can only be one THIS document declares —
// walking the whole project tree (85k+ symbols on a large project) was both an O(project) tax on the go-to-def
// hot path AND a latent bug (a doc-local offset can coincidentally fall inside another file's span). Restrict to
// this doc's contribution: its top-level names (project-scope symbols tagged by `uri`) + its own scope subtrees
// (project children tagged by `defUri`).
function symbolDefinedAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  for (const syms of project.symbols.values())
    for (const s of syms) if (s.uri === doc.uri && spanContains(s.span, offset)) return s
  const walk = (scope: Scope): Symbol | undefined => {
    for (const syms of scope.symbols.values()) for (const s of syms) if (spanContains(s.span, offset)) return s
    for (const child of scope.children) {
      const inner = walk(child)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  for (const child of project.children)
    if (child.defUri === doc.uri) {
      const found = walk(child)
      if (found !== undefined) return found
    }
  return undefined
}
