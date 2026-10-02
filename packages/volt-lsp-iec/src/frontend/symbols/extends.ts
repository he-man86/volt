/**
 * EXTENDS — each scope's base, linked once the whole project is bound (the base may live in a later file), and the
 * chain of bases walked from it.
 */
import { libraryOf, type LibraryManifest } from "../library/index.js"
import type { Scope } from "./model.js"
import { childIndex, setLibVisible } from "./cache.js"
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
//
// <b>A relink after an edit links only what the edit can have changed</b> (linking every scope was ~3 ms of each keystroke
// on pro2193, 2026-10-02). A scope's base is picked from the candidates under its base name and the published
// visibility, so with the same manifests it can change only when a top-level scope of that name was bound or unbound
// (`noteTopLevel`) — or when the scope itself is new.
export function linkExtends(project: Scope, manifests: readonly LibraryManifest[] = []): void {
  const kept = linked.get(project)
  if (kept !== undefined && sameManifests(kept.manifests, manifests)) {
    for (const c of project.children) {
      if (c.extendsName === undefined || (!kept.added.has(c) && !kept.names.has(baseName(c.extendsName)))) continue
      c.baseScope = undefined
      linkOne(project, c, manifests, kept.visible)
    }
    kept.names.clear()
    kept.added.clear()
    return
  }
  for (const c of project.children) c.baseScope = undefined

  // PUBLISHED ON THE PROJECT, not kept local: `EXTENDS` is only one of the lookups that can face several
  // candidates for one name, and every one of them has to answer the same way. `precedence.ts` reads this.
  const byTitle = manifestsByTitle(manifests)
  const visible = new Map<string, Set<string>>()
  for (const m of manifests) visible.set(m.folder.toLowerCase(), visibleFolders(manifests, m, byTitle))
  setLibVisible(project, visible)

  for (const c of project.children) if (c.extendsName !== undefined) linkOne(project, c, manifests, visible)
  linked.set(project, { manifests, visible, names: new Set(), added: new Set() })
}

/** Link `c` (which names a base) to the candidate its file means, if any. */
function linkOne(
  project: Scope,
  c: Scope,
  manifests: readonly LibraryManifest[],
  visible: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  // The candidates for a bare base name: the project's children under it, in project order, that can be a base. Read
  // off the child-name index (rebuilt once per generation, and every check reads it too) — this built its own
  // lower-cased map of every child on every relink: the largest share of a rebind on the fixture project (2026-10-01).
  const candidates = (key: string): Scope[] => (childIndex(project).get(key) ?? []).filter(isCandidate)
  const base = pickForAsker(
    project,
    (qualifiedCandidates(project, c.extendsName!, manifests, visible) ?? candidates(c.extendsName!)).filter((x) => x !== c),
    (x) => x.defUri,
    c.defUri,
  )
  if (base !== undefined) c.baseScope = base
}

const isCandidate = (c: Scope): boolean =>
  (c.extendsName !== undefined || c.kind === "pou" || c.kind === "interface" || c.kind === "struct") &&
  c.undeclared !== true // a refused FB is no base (`FB_D EXTENDS FB_A`, FB_A's header refused)

/** The unit a base name names: the name after a qualifying namespace. */
const baseName = (extendsName: string): string => extendsName.slice(extendsName.lastIndexOf(".") + 1)

/** A default `[]` is a new array per call, and still the same (no) manifests. */
const sameManifests = (a: readonly LibraryManifest[], b: readonly LibraryManifest[]): boolean =>
  a === b || (a.length === 0 && b.length === 0)

/** What each project was last fully linked with, and what changed among its top-level scopes since. */
const linked = new WeakMap<
  Scope,
  { manifests: readonly LibraryManifest[]; visible: Map<string, Set<string>>; names: Set<string>; added: Set<Scope> }
>()

/**
 * Top-level scopes were bound into (`added`) or unbound from `project` — `bindFile` / `unbindFile` say so, so the next
 * link revisits every scope whose base name is one of theirs. Nothing to note before the first full link.
 */
export function noteTopLevel(project: Scope, scopes: readonly Scope[], added: boolean): void {
  const kept = linked.get(project)
  if (kept === undefined) return
  for (const s of scopes) {
    kept.names.add(s.name.toLowerCase())
    if (added) kept.added.add(s)
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
