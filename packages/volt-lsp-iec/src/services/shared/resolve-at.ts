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
  allUnits,
  type Expr,
  type MemberExpr,
  type ParseResult,
  spanContains,
  walkAllExprs,
  walkExpr,
} from "../../frontend/syntax/index.js"
import {
  bareEnumMember,
  bodiesAt,
  lookup,
  lookupUnit,
  type Scope,
  scopeForUnit,
  type Symbol,
  symbolDefinedAt,
} from "../../frontend/symbols/index.js"
import { boxMember, resolveMemberChain } from "../../frontend/types/index.js"
import type { Document } from "./document.js"
import { tokenAtOffset } from "./positions.js"
import { unitTypeNameRefs } from "./type-refs.js"

export function resolveAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  // Body path — resolve through the statement tree where the cursor sits, in the body's own scope (a property accessor's
  // for its locals; this used the unit scope, so a getter-local resolved nowhere — consolidate-lsp-structure A5).
  for (const { scope, statements } of bodiesAt(doc.parseResult.units, project, offset)) {
    const walk = (visit: (e: Expr) => void) => walkAllExprs(statements, visit)
    const sym = resolveInExprs(walk, scope, project, offset)
    if (sym !== undefined) return sym
  }
  // An initial value (`a : INT := g;`) — its names resolve in the unit's scope, as the declaration does
  for (const unit of allUnits(doc.parseResult.units)) {
    if (!("varSections" in unit) || !spanContains(unit.span, offset)) continue
    for (const section of unit.varSections)
      for (const decl of section.decls) {
        const init = decl.init
        if (init === undefined || init.kind === "aggregate_init" || !spanContains(init.span, offset)) continue
        const scope = scopeForUnit(project, unit)
        if (scope !== undefined) return resolveInExprs((visit) => walkExpr(init, visit), scope, project, offset)
      }
  }

  // Declaration path — the cursor is on a defining identifier, a type name, or a modifier.
  // A type position first: it defines nothing, and a list's symbol spans every offset of its list
  const at = tokenAtOffset(doc.parseResult.tokens, offset)
  const tok = at !== undefined && (at.kind === "identifier" || at.kind === "keyword") ? at : undefined
  if (tok !== undefined && inTypePosition(doc.parseResult, tok.span.start))
    return lookupUnit(unitScopeAtOffset(doc.parseResult, project, offset), tok.text)?.symbol
  const onDef = symbolDefinedAt(project, doc.uri, offset)
  if (onDef !== undefined) return onDef
  if (tok !== undefined) {
    const scope = unitScopeAtOffset(doc.parseResult, project, offset)
    return lookup(scope, tok.text)?.symbol ?? bareEnumMember(scope, tok.text)
  }
  return undefined
}

/** The symbol the expression under `offset` names among those `walk` visits: a member chain's member, a bare name, a `.g`. */
function resolveInExprs(
  walk: (visit: (e: Expr) => void) => void,
  scope: Scope,
  project: Scope,
  offset: number,
): Symbol | undefined {
  let member: MemberExpr | undefined
  let best: Expr | undefined
  walk((e) => {
    if (e.kind === "member" && offset >= e.member.span.start && offset < e.member.span.end) member = e
    if (
      offset >= e.span.start &&
      offset < e.span.end &&
      (best === undefined || e.span.end - e.span.start < best.span.end - best.span.start)
    )
      best = e
  })
  const viaMember = member === undefined ? undefined : resolveMember(member, scope, project)
  if (viaMember !== undefined) return viaMember
  if (best?.kind === "ident_expr") return lookup(scope, best.name)?.symbol ?? bareEnumMember(scope, best.name)
  // `.g` — the global past every local (rule E33)
  if (best?.kind === "global_expr") return resolveMemberChain(best, scope, project)
  return undefined
}

/** Whether `start` begins an unqualified type position (`unitTypeNameRefs`) of the document. */
function inTypePosition(parseResult: ParseResult, start: number): boolean {
  for (const unit of allUnits(parseResult.units))
    for (const ref of unitTypeNameRefs(unit)) if (!ref.qualified && ref.span.start === start) return true
  return false
}

/** The symbol a member names; the member closing an FB box's call (`t1(…).Q`) is the output of its instance: the call's
 *  own type is no FB's. */
export function resolveMember(member: MemberExpr, scope: Scope, project: Scope): Symbol | undefined {
  const instance = member.base.kind === "call" ? boxMember(member, scope, project)?.box.instance : undefined
  return resolveMemberChain(instance !== undefined ? { ...member, base: instance } : member, scope, project)
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
