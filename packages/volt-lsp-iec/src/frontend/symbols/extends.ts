/**
 * EXTENDS — each scope's base, linked once the whole project is bound (the base may live in a later file), and the
 * chain of bases walked from it.
 */
import { libraryOf, type LibraryManifest } from "../library/index.js"
import type { Scope } from "./model.js"
import { setLibVisible } from "./cache.js"
import { manifestsByTitle, visibleFolders } from "./library-namespaces.js"
import { pickForAsker } from "./precedence.js"

/**
 * Post-pass: link each `EXTENDS` scope to its base scope (through `relink`, which puts the project in canonical order
 * first). Separated from the ingest walk because the base may
 * live in a later file — resolution needs the whole project ingested first. Idempotent: resets every base
 * pointer first so an incremental re-link can't leave a link into a removed scope.
 *
 * <b>A NAME CAN HAVE SEVERAL CANDIDATES, AND WHICH ONE IS RIGHT DEPENDS ON WHO IS ASKING.</b> This used to be
 * one `Map.set` per candidate, so the LAST one bound won — and bind order is file order, which is
 * `readdirSync` order. Measured across the six corpus projects: 343 names have more than one candidate and 19
 * of those are reached by an `EXTENDS`. They are not harmless duplicates. `ETRIG` is exported by BOTH `CAA
 * Behaviour Model` (namespace CBM, CAA Technical Workgroup) and `CBML` (Common Behaviour Model, 3S) with
 * DIFFERENT declarations — `ETRIGTL` carries an `EXTENDS` in one and none in the other — and both libraries
 * are referenced by the same project. CODESYS tells them apart by NAMESPACE; Volt materializes both into
 * `Library Manager/<folder>/` under their bare names, so the bare name really is ambiguous here.
 *
 * The manifests settle it, and they already carry what is needed. `CAA Device Diagnosis`, `CAA File` and `CAA
 * Storage` each DEPEND ON `CAA Behaviour Model`, so their `EXTENDS ETRIG` means CBM's. `VisuUtils` depends on
 * `CBML`, so the same three characters in that file mean a different base class. No positional rule can be
 * right for both, which is why this resolves by who is asking:
 *
 * — ranked as `precedence.ts` defines (the one copy of the rank table).
 *
 * Ties break on the defining URI, so the answer does not depend on bind order at any rank. That matters
 * beyond determinism: the live server re-links incrementally as files open and change, so a bind-order rule
 * could hand the same workspace different bases between two keystrokes.
 */
export function linkExtends(project: Scope, manifests: readonly LibraryManifest[] = []): void {
  for (const c of project.children) c.baseScope = undefined

  const candidates = new Map<string, Scope[]>()
  for (const c of project.children) {
    if (c.extendsName === undefined && c.kind !== "pou" && c.kind !== "interface" && c.kind !== "struct")
      continue
    if (c.undeclared === true) continue // a refused FB is no base (`FB_D EXTENDS FB_A`, FB_A's header refused)
    const key = c.name.toLowerCase()
    const list = candidates.get(key)
    if (list === undefined) candidates.set(key, [c])
    else list.push(c)
  }

  // PUBLISHED ON THE PROJECT, not kept local: `EXTENDS` is only one of the lookups that can face several
  // candidates for one name, and every one of them has to answer the same way. `precedence.ts` reads this.
  const byTitle = manifestsByTitle(manifests)
  const visible = new Map<string, Set<string>>()
  for (const m of manifests) visible.set(m.folder.toLowerCase(), visibleFolders(manifests, m, byTitle))
  setLibVisible(project, visible)

  for (const c of project.children) {
    if (c.extendsName === undefined) continue
    const base = pickForAsker(
      project,
      (qualifiedCandidates(project, c.extendsName, manifests, visible) ?? candidates.get(c.extendsName) ?? []).filter((x) => x !== c),
      (x) => x.defUri,
      c.defUri,
    )
    if (base !== undefined) c.baseScope = base
  }
}

/**
 * A QUALIFIED base (`EXTENDS Standard.TON`, `unit_fb_extends_qualified` — CODESYS builds it, 2026-10-01): the name
 * before the dot is a library's NAMESPACE (its manifest's), the one after it a unit that library — or a library it
 * depends on — materialized. Read off the manifests, not the namespace scopes: those are bound after the link.
 * `undefined` for a bare name; an empty list for a namespace no manifest declares or a unit it does not hold — a
 * qualified name never falls back to a bare one.
 */
function qualifiedCandidates(
  project: Scope,
  extendsName: string,
  manifests: readonly LibraryManifest[],
  visible: ReadonlyMap<string, ReadonlySet<string>>,
): Scope[] | undefined {
  const dot = extendsName.lastIndexOf(".")
  if (dot < 0) return undefined
  const namespace = extendsName.slice(0, dot)
  const name = extendsName.slice(dot + 1)
  const folders = new Set(
    manifests.filter((m) => m.namespace.toLowerCase() === namespace).flatMap((m) => [...(visible.get(m.folder.toLowerCase()) ?? [])]),
  )
  return project.children.filter((s) => {
    if (s.name.toLowerCase() !== name || s.defUri === undefined || s.undeclared === true) return false
    const lib = libraryOf({ uri: s.defUri })?.toLowerCase()
    return lib !== undefined && folders.has(lib)
  })
}
/** The scope `scope` EXTENDS, as `linkExtends` resolved it — undefined without an EXTENDS or when its base resolved
 *  to nothing. */
export function baseOf(scope: Scope): Scope | undefined {
  return scope.baseScope
}

/**
 * `scope` and every scope it EXTENDS, BASE-FIRST (the most basic first, `scope` last) — each scope once: a cycle
 * (`A EXTENDS B`, `B EXTENDS A`, which both bind) ends the chain where it closes.
 */
export function extendsChain(scope: Scope): Scope[] {
  const chain: Scope[] = []
  const seen = new Set<Scope>()
  for (let s: Scope | undefined = scope; s !== undefined && !seen.has(s); s = s.baseScope) {
    seen.add(s)
    chain.push(s)
  }
  return chain.reverse()
}
