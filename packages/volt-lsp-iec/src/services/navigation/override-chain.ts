/**
 * override-chain (Layer E · navigation, openspec lsp-quick-fixes design.md §6 B6). A METHOD or PROPERTY is one name
 * across the members that override or implement each other: an FB's member and its bases' of that name, the members of
 * the interfaces the FB or any base IMPLEMENTS (and their bases), and — the other way — every FB that derives from or
 * implements them. Renaming one of them alone leaves the rest disagreeing (C0094 / C0089 / C0087), so a rename renames
 * the whole chain; one that reaches a LIBRARY member is refused by name, as no edit of the project can rename that.
 */
import { ancestry, findScopeByName, isLibrarySymbol, lookupLocal, type Scope, scopeUri, type Symbol } from "../../frontend/symbols/index.js"

const MEMBER_KINDS: ReadonlySet<string> = new Set(["method", "property", "interface_method", "interface_property"])

/** Is `sym` a member an override chain can hold — a method or property of an FB, or an interface's? */
const isChainMember = (sym: Symbol): boolean => MEMBER_KINDS.has(sym.kind) && (sym.owner.kind === "pou" || sym.owner.kind === "interface")

/** Every member `sym` overrides, implements, or is overridden or implemented by — transitively, `sym` included. */
export function overrideChain(project: Scope, sym: Symbol): Symbol[] {
  if (!isChainMember(sym)) return [sym]
  const key = sym.name.toLowerCase()
  const edges = new Map<Symbol, Set<Symbol>>()
  const link = (a: Symbol, b: Symbol): void => {
    if (a === b) return
    ;(edges.get(a) ?? edges.set(a, new Set()).get(a)!).add(b)
    ;(edges.get(b) ?? edges.set(b, new Set()).get(b)!).add(a)
  }
  const memberOf = (scope: Scope): Symbol | undefined => (scope.symbols.get(key) ?? []).find((s) => MEMBER_KINDS.has(s.kind))
  for (const scope of typeScopes(project)) {
    const own = memberOf(scope)
    if (own === undefined) continue
    const related = scope.kind === "interface" ? ancestry(scope).slice(1) : [...ancestry(scope).slice(1), ...implemented(project, scope)]
    for (const other of related) {
      const theirs = memberOf(other)
      if (theirs !== undefined) link(own, theirs)
    }
  }
  const chain = new Set<Symbol>([sym])
  const queue = [sym]
  while (queue.length > 0)
    for (const next of edges.get(queue.pop()!) ?? [])
      if (!chain.has(next)) {
        chain.add(next)
        queue.push(next)
      }
  return [...chain]
}

/** The library members of `sym`'s chain — a rename of any member of it cannot make the project whole. */
export const libraryMembersOf = (project: Scope, sym: Symbol): Symbol[] => overrideChain(project, sym).filter(isLibrarySymbol)

/** Every FB and interface scope of the project, a library namespace's included. */
function* typeScopes(scope: Scope): Generator<Scope> {
  for (const child of scope.children) {
    if (child.kind === "pou" || child.kind === "interface") yield child
    if (child.kind === "namespace") yield* typeScopes(child)
  }
}

/** The interfaces an FB scope or any of its bases IMPLEMENTS, with their bases. */
function implemented(project: Scope, fb: Scope): Scope[] {
  const out: Scope[] = []
  for (const s of ancestry(fb)) {
    const sym = s.parent === undefined ? undefined : lookupLocal(s.parent, s.name).find((x) => x.kind === "function_block" && x.declarationSpan === s.span)
    if (sym?.ast.kind !== "function_block") continue
    for (const name of sym.ast.implements ?? []) {
      const iface = findScopeByName(project, name.text, scopeUri(s))
      if (iface?.kind === "interface") out.push(...ancestry(iface))
    }
  }
  return out
}
