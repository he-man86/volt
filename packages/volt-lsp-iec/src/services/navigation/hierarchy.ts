/**
 * hierarchy (Layer E · E.2). Type hierarchy (super/sub via EXTENDS/IMPLEMENTS) and call hierarchy
 * (incoming/outgoing). Call incoming is TYPE-AWARE: `fb.Step()` resolves through the base's type to
 * the exact method symbol, so a same-named method on a DIFFERENT FB is NOT reported as a caller.
 */
import type { Range, SymbolKind as LspKind } from "vscode-languageserver-protocol"
import { walkAllExprs, type TopLevel } from "../../syntax/index.js"
import { findScopeByName, lookup, type Scope, type Symbol } from "../../symbols/index.js"
import { resolveMemberChain } from "../../types/index.js"
import { lspSymbolKind, rangeFromSpan, resolveAt, stBodies, type Document } from "../shared/index.js"

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

/** Supertypes: the EXTENDS base + every IMPLEMENTS interface of an FB/interface. */
export function typeSupertypes(project: Scope, sym: Symbol): HierItem[] {
  const ast = sym.ast
  const names: string[] = []
  if (ast.kind === "function_block") {
    if (ast.extends !== undefined) names.push(ast.extends.text)
    for (const i of ast.implements ?? []) names.push(i.text)
  } else if (ast.kind === "interface") {
    for (const i of ast.extends ?? []) names.push(i.text)
  }
  const out: HierItem[] = []
  for (const name of new Set(names)) {
    const s = lookup(project, name)?.symbol
    if (s !== undefined) out.push(itemOf(s))
  }
  return out
}

/** Subtypes: every FB/interface that EXTENDS or IMPLEMENTS `sym`, across the workspace. */
export function typeSubtypes(docs: Iterable<Document>, sym: Symbol): HierItem[] {
  const target = sym.name.toLowerCase()
  const out: HierItem[] = []
  for (const d of docs) {
    for (const unit of d.parseResult.units) {
      const derived =
        (unit.kind === "function_block" &&
          (unit.extends?.text.toLowerCase() === target ||
            (unit.implements ?? []).some((i) => i.text.toLowerCase() === target))) ||
        (unit.kind === "interface" && (unit.extends ?? []).some((i) => i.text.toLowerCase() === target))
      if (derived && "name" in unit) {
        out.push({
          name: unit.name.text,
          kind: lspSymbolKind(unit.kind === "interface" ? "interface" : "function_block"),
          uri: d.uri,
          range: rangeFromSpan(unit.span),
          selectionRange: rangeFromSpan(unit.name.span),
        })
      }
    }
  }
  return out
}

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
    for (const { unit, scope, statements } of stBodies(d, project)) {
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
  for (const { unit, scope, statements } of stBodies(doc, project)) {
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
