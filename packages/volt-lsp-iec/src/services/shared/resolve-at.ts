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
  type ParseResult,
  spanContains,
} from "../../frontend/syntax/index.js"
import { bodiesAt, lookup, resolveBareEnumMember, type Scope, scopeForUnit, type Symbol, symbolDefinedAt } from "../../frontend/symbols/index.js"
import { resolveMemberChain } from "../../frontend/types/index.js"
import type { Document } from "./document.js"
import { exprAtOffset, memberAtOffset, tokenAtOffset } from "./positions.js"

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
    // `.g` — the global past every local (rule E33)
    if (expr?.kind === "global_expr") return resolveMemberChain(expr, scope, project)
  }

  // Declaration path — the cursor is on a defining identifier, a type name, or a modifier.
  const onDef = symbolDefinedAt(project, doc.uri, offset)
  if (onDef !== undefined) return onDef
  const tok = tokenAtOffset(doc.parseResult.tokens, offset)
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
