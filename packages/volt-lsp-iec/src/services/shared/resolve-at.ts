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
  exprAtOffset,
  isGraphicalBody,
  memberAtOffset,
  parseStatements,
  unitBodies,
  type BodySpan,
  type ParseResult,
  type StatementList,
  type TopLevel,
} from "../../syntax/index.js"
import { lookup, resolveBareEnumMember, scopeForUnit, type Scope, type Symbol } from "../../symbols/index.js"
import { resolveMemberChain } from "../../types/index.js"
import { spanContains } from "./positions.js"
import { tokenAtOffset } from "./token-scan.js"

export interface Document {
  uri: string
  source: string
  parseResult: ParseResult
}

/**
 * Iterate every cleanly-parsed ST body of a document with its unit + scope + statement tree — the ONE
 * "walk the POU bodies" loop the nav/assist/structure features share (references, hierarchy, folding, …).
 * Graphical bodies and bodies that don't parse are skipped (conservative).
 */
export function* stBodies(
  doc: Document,
  project: Scope,
): Generator<{ unit: TopLevel; scope: Scope; statements: StatementList }> {
  for (const unit of doc.parseResult.units) {
    const scope = scopeForUnit(project, unit) ?? project
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) continue
      const parsed = parseStatements(body)
      if (parsed.ok) yield { unit, scope, statements: parsed.statements }
    }
  }
}

export function resolveAt(doc: Document, project: Scope, offset: number): Symbol | undefined {
  // Body path — resolve through the statement tree where the cursor sits.
  for (const { body, scope } of stBodiesAtOffset(doc.parseResult, project, offset)) {
    const parsed = parseStatements(body)
    if (!parsed.ok) continue
    const member = memberAtOffset(parsed.statements, offset)
    if (member !== undefined) {
      const sym = resolveMemberChain(member, scope, project)
      if (sym !== undefined) return sym
    }
    const expr = exprAtOffset(parsed.statements, offset)
    if (expr?.kind === "ident_expr") {
      return lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name)
    }
  }

  // Declaration path — the cursor is on a defining identifier, a type name, or a modifier.
  const onDef = symbolDefinedAt(project, offset)
  if (onDef !== undefined) return onDef
  const tok = tokenAtOffset(doc.source, offset)
  if (tok !== undefined && (tok.kind === "identifier" || tok.kind === "keyword")) {
    const scope = unitScopeAtOffset(doc.parseResult, project, offset)
    return lookup(scope, tok.text)?.symbol ?? resolveBareEnumMember(project, tok.text)
  }
  return undefined
}

/** ST (non-graphical) bodies containing the offset, paired with their unit scope. */
function* stBodiesAtOffset(
  parseResult: ParseResult,
  project: Scope,
  offset: number,
): Generator<{ body: BodySpan; scope: Scope }> {
  for (const unit of parseResult.units) {
    if (!spanContains(unit.span, offset)) continue
    const scope = scopeForUnit(project, unit) ?? project
    for (const body of unitBodies(unit)) {
      if (spanContains(body.span, offset) && !isGraphicalBody(body)) yield { body, scope }
    }
  }
}

/** The scope of the innermost unit containing the offset (project scope as the fallback). */
export function scopeAtOffset(doc: Document, project: Scope, offset: number): Scope {
  return unitScopeAtOffset(doc.parseResult, project, offset)
}

function unitScopeAtOffset(parseResult: ParseResult, project: Scope, offset: number): Scope {
  for (const unit of parseResult.units) {
    if (spanContains(unit.span, offset)) return scopeForUnit(project, unit) ?? project
  }
  return project
}

/** The symbol whose DEFINING identifier span covers the offset (cursor sits on a declaration). */
function symbolDefinedAt(project: Scope, offset: number): Symbol | undefined {
  const walk = (scope: Scope): Symbol | undefined => {
    for (const syms of scope.symbols.values()) {
      for (const s of syms) if (spanContains(s.span, offset)) return s
    }
    for (const child of scope.children) {
      const inner = walk(child)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  return walk(project)
}
