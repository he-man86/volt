/**
 * Incremental dead-code support (Layer G) — lets the workspace store skip the O(project) reachability fixpoints when an
 * edit changes nothing they depend on. Only the live server caches dead sets; the computation itself stays in
 * `analysis/reachability`. It lived there too (consolidate-lsp-structure C10).
 */
import type { FileReachInfo } from "../analysis/index.js"


/** The names that are reachability graph NODES — a bare ref to one can move the dead set (a POU/interface, or a
 *  member for `deadMemberSpans`). Every other identifier (locals, elementary types, half-typed tokens) is inert.
 *  A file's refs projected through this set change only when a genuine call to a node is added/removed, so an edit
 *  whose projection is unchanged provably can't alter either dead computation — the caller can keep its cache. */
export function deadNameUniverse(infos: readonly FileReachInfo[]): Set<string> {
  const names = new Set<string>()
  for (const info of infos) {
    for (const p of info.pous) names.add(p)
    for (const m of info.ifaceMethods) names.add(m)
    for (const [iface] of info.implementers) names.add(iface)
    for (const u of info.units)
      if (!u.isPou && (u.kind === "method" || u.kind === "action" || u.kind === "property")) names.add(u.name)
  }
  return names
}

const arrSetEq = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const x of b) if (!set.has(x)) return false
  return true
}
const projEq = (a: ReadonlySet<string>, b: ReadonlySet<string>, names: ReadonlySet<string>): boolean => {
  let na = 0
  for (const x of a) if (names.has(x)) { na++; if (!b.has(x)) return false }
  let nb = 0
  for (const x of b) if (names.has(x)) nb++
  return na === nb
}

/** Whether two versions of ONE file contribute IDENTICALLY to `deadPousFromInfos` + `deadMemberSpansFromInfos`
 *  under the given name universe. If true, swapping `a` for `b` in the infos cannot change either dead set, so a
 *  cached result stays valid. Conservative — any difference in a declared name, structural field, or a
 *  reachability-relevant ref returns false (recompute). Used to make the dead passes skip on a within-body edit. */
export function reachDeadEquivalent(
  a: FileReachInfo | undefined,
  b: FileReachInfo | undefined,
  deadNames: ReadonlySet<string>,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.owner !== b.owner || a.root !== b.root) return false
  if (!arrSetEq(a.pous, b.pous) || !arrSetEq(a.programs, b.programs) || !arrSetEq(a.ifaceMethods, b.ifaceMethods))
    return false
  if (a.implementers.length !== b.implementers.length) return false
  for (let i = 0; i < a.implementers.length; i++) {
    if (a.implementers[i]![0] !== b.implementers[i]![0] || !arrSetEq(a.implementers[i]![1], b.implementers[i]![1]))
      return false
  }
  if (!projEq(a.refs, b.refs, deadNames)) return false
  if (a.units.length !== b.units.length) return false
  for (let i = 0; i < a.units.length; i++) {
    const ua = a.units[i]!
    const ub = b.units[i]!
    if (ua.name !== ub.name || ua.kind !== ub.kind || ua.isPou !== ub.isPou) return false
    if (!projEq(ua.refs, ub.refs, deadNames)) return false
  }
  return true
}

