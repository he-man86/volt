/**
 * hierarchy (Layer E · E.2). Type hierarchy (super/sub via EXTENDS/IMPLEMENTS) and call hierarchy
 * (incoming/outgoing). Call incoming is TYPE-AWARE: `fb.Step()` resolves through the base's type to
 * the exact method symbol, so a same-named method on a DIFFERENT FB is NOT reported as a caller.
 */
import type { Range, SymbolKind as LspKind } from "vscode-languageserver-protocol"
import { type TopLevel, walkAllExprs } from "../../frontend/syntax/index.js"
import { basesOf, childScopesByName, findScopeByName, lookup, lookupLocal, type Scope, sourceBodies, type Symbol } from "../../frontend/symbols/index.js"
import { resolveMemberChain } from "../../frontend/types/index.js"
import { lspSymbolKind, rangeFromSpan, resolveAt } from "../shared/index.js"
import type { Document } from "../shared/index.js"

export interface HierItem {
  name: string
  kind: LspKind
  uri: string
  range: Range
  selectionRange: Range
}

// ─── type hierarchy ──────────────────────────────────────────────────────────

export function prepareTypeHierarchy(
  doc: Document,
  project: Scope,
  offset: number,
): { item: HierItem; sym: Symbol } | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined || !isTypeLike(sym)) return undefined
  return { item: itemOf(sym), sym }
}

/**
 * Supertypes: what an FB or interface EXTENDS — the bases the symbol table LINKED (`extends.ts`, by precedence among
 * same-named candidates, rule H8; an interface's whole list, H4) — and every interface an FB IMPLEMENTS.
 */
export function typeSupertypes(project: Scope, sym: Symbol): HierItem[] {
  const out = new Map<Symbol, HierItem>()
  const scope = scopeOf(sym)
  for (const b of scope === undefined ? [] : basesOf(scope)) {
    const s = symbolOf(b)
    if (s !== undefined) out.set(s, itemOf(s))
  }
  if (sym.ast.kind === "function_block")
    for (const i of sym.ast.implements ?? []) {
      const s = lookup(project, i.text)?.symbol
      if (s !== undefined) out.set(s, itemOf(s))
    }
  return [...out.values()]
}

/** Subtypes: every FB/interface whose linked base is `sym`'s scope, or that IMPLEMENTS `sym`, across the project. */
export function typeSubtypes(project: Scope, sym: Symbol): HierItem[] {
  const target = scopeOf(sym)
  const name = sym.name.toLowerCase()
  const out: HierItem[] = []
  for (const child of project.children) {
    if (child.kind !== "pou" && child.kind !== "interface") continue
    const s = symbolOf(child)
    if (s === undefined) continue
    const implementsIt = s.ast.kind === "function_block" && (s.ast.implements ?? []).some((i) => i.text.toLowerCase() === name)
    if ((target !== undefined && basesOf(child).includes(target)) || implementsIt) out.push(itemOf(s))
  }
  return out
}

/** The scope a top-level FB/interface symbol declares (its own span). */
const scopeOf = (sym: Symbol): Scope | undefined => childScopesByName(sym.owner, sym.name).find((c) => c.span === sym.declarationSpan)

/** The FB/interface symbol a top-level scope is the scope of. */
const symbolOf = (scope: Scope): Symbol | undefined =>
  scope.parent === undefined ? undefined : lookupLocal(scope.parent, scope.name).find((s) => s.declarationSpan === scope.span && isTypeLike(s))

// ─── call hierarchy ──────────────────────────────────────────────────────────

export function prepareCallHierarchy(
  doc: Document,
  project: Scope,
  offset: number,
): { item: HierItem; sym: Symbol } | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined || !isCallable(sym)) return undefined
  return { item: itemOf(sym), sym }
}

export interface CallRef {
  item: HierItem
  ranges: Range[]
}

/** Who calls `target` — type-aware: only calls whose callee resolves to the exact `target` symbol. */
export function callIncoming(docs: Iterable<Document>, project: Scope, target: Symbol): CallRef[] {
  const byCaller = new Map<Symbol, { item: HierItem; ranges: Range[] }>()
  for (const d of docs) {
    for (const { unit, scope, statements } of sourceBodies(d.parseResult.units, project)) {
      const callerSym = unitSymbol(unit, project)
      if (callerSym === undefined) continue
      walkAllExprs(statements, (e) => {
        if (e.kind !== "call" || resolveMemberChain(e.callee, scope, project) !== target) return
        const rec = byCaller.get(callerSym) ?? { item: itemOf(callerSym), ranges: [] }
        rec.ranges.push(rangeFromSpan(e.callee.span))
        byCaller.set(callerSym, rec)
      })
    }
  }
  return [...byCaller.values()]
}

/** What `source` calls — the callables invoked in its body. */
export function callOutgoing(doc: Document, project: Scope, source: Symbol): CallRef[] {
  const byCallee = new Map<Symbol, { item: HierItem; ranges: Range[] }>()
  for (const { unit, scope, statements } of sourceBodies(doc.parseResult.units, project)) {
    if (!("name" in unit) || unit.name.span !== source.span) continue // only the source POU's body
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const callee = resolveMemberChain(e.callee, scope, project)
      if (callee === undefined || !isCallable(callee)) return
      const rec = byCallee.get(callee) ?? { item: itemOf(callee), ranges: [] }
      rec.ranges.push(rangeFromSpan(e.callee.span))
      byCallee.set(callee, rec)
    })
  }
  return [...byCallee.values()]
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function itemOf(sym: Symbol): HierItem {
  return {
    name: sym.name,
    kind: lspSymbolKind(sym.kind),
    uri: sym.uri,
    range: rangeFromSpan(sym.declarationSpan),
    selectionRange: rangeFromSpan(sym.span),
  }
}

function isTypeLike(sym: Symbol): boolean {
  return sym.kind === "function_block" || sym.kind === "interface" || sym.kind === "program"
}

function isCallable(sym: Symbol): boolean {
  return sym.kind === "function_block" || sym.kind === "function" || sym.kind === "method" || sym.kind === "action"
}

function unitSymbol(unit: TopLevel, project: Scope): Symbol | undefined {
  if (!("name" in unit)) return undefined
  const scope = findScopeByName(project, unit.name.text)
  return scope?.parent !== undefined
    ? lookup(scope.parent, unit.name.text)?.symbol
    : lookup(project, unit.name.text)?.symbol
}
