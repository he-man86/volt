/**
 * A referenced library's NAMESPACE, bound over the units it materialized.
 *
 * `volt pull` writes each referenced library under `Library Manager/<folder>/`, one declaration file per element, plus a
 * `<folder>.library` manifest naming it:
 *
 *     LIBRARY L_IE1P_ApplicationErrorsTypes
 *     NAMESPACE L_IE1P_Types
 *     RESOLUTION L_IE1P_ApplicationErrorsTypes, 3.32.0.11 (Lenze)
 *
 * The code writes the NAMESPACE, never the folder — `L_IE1P.L_IE1P_SeverityLevel.No_Response`, `L_LA.L_AddLog2` — and the
 * manifests were never read, so those declarations sat in the table under their own names while every qualified use
 * resolved to nothing. That is one name in eight of the corpus's blocked POUs.
 *
 * The binding is ADDITIVE and shares the very same scopes: a `namespace` scope per library whose children ARE the
 * library's top-level scopes and whose symbols ARE its top-level symbols. Nothing is reparented, so every bare name that
 * resolved before still resolves the same way, and members, EXTENDS bases and go-to-definition answer through the
 * namespace exactly as they already do through the project.
 */
import type { Namespace, Span } from "../syntax/index.js"
import { defineSymbol, libraryOf, makeScope, type Scope, type Symbol } from "./symbol.js"
import { findChildScope } from "./scope-nav.js"

export interface LibraryManifest {
  /** The manifest file itself. It is what the namespace symbol declares, so `isLibrarySymbol` answers TRUE for it:
   *  a library's member set is incomplete by construction (signatures, and only what the project materialized), and
   *  every check that already skips library types skips the namespace for the same reason. */
  uri: string
  /** The `Library Manager/<folder>` this manifest describes — how its declaration files are recognised. */
  folder: string
  /** The name the source qualifies with. */
  namespace: string
  /** The manifest's own LIBRARY line — the library's TITLE, which is how other manifests name it. */
  library: string
  /** The titles the DEPENDENCIES line lists. A namespace also sees its dependencies' elements: pro2193 writes
   *  `L_IE1P.L_IE1P_SeverityLevel`, and that enum belongs to `L_IE1P_ApplicationErrorsTypes`, which the
   *  `L_IE1P_ApplicationErrors` library (namespace `L_IE1P`) depends on. Titles that name no manifest are ignored. */
  dependencies: readonly string[]
  /** Which materialization wrote the library's declarations — its MATERIALIZATION line, 1 when the manifest predates
   *  the line. Below `LIBRARY_MATERIALIZATION` the declarations are known to be incomplete (`staleLibraryManifests`). */
  materialization: number
}

/**
 * The materialization the bridge writes today — `LibraryManifest.Materialization` in C#, which says what each format
 * added. 2: FUNCTIONs without a return type are rendered; format 1 skipped them, so a library pulled by it is missing
 * elements the project calls, and every call to one reads as undefined here, where a library is known only through its
 * materialization. Nothing in the LSP fills that gap — the manifest is told to re-pull instead.
 */
export const LIBRARY_MATERIALIZATION = 2

/** The manifests a pull by an older bridge wrote — whose declarations miss what the current one materializes. */
export function staleLibraryManifests(manifests: readonly LibraryManifest[]): LibraryManifest[] {
  return manifests.filter((m) => m.materialization < LIBRARY_MATERIALIZATION)
}

/** A path as the manifest match reads it: forward slashes, decoded spaces, lower case. */
const normalize = (uri: string): string => uri.replace(/%20/g, " ").replaceAll("\\", "/").toLowerCase()

/**
 * A manifest's RESOLUTION line — `RESOLUTION Standard, 3.5.18.0 (System)` — as the library and the version the project
 * resolved; undefined without one. The one reading of it: the library repo is looked up by it (`libraries/index.ts`),
 * and its interface gate finds the materialization to hold a version to by it. (The bridge's `LibraryFetch.ResolutionLine`
 * reads the same line whole, as the key a library signature joins its manifest by — a different question.)
 */
export function libraryResolution(source: string): { library: string; version: string } | undefined {
  const m = /^RESOLUTION[ \t]+(.+?),[ \t]*(\S+)/m.exec(source)
  return m === null ? undefined : { library: m[1]!.trim(), version: m[2]! }
}

/** `<folder>.library`'s LIBRARY and NAMESPACE lines — undefined when the file is not one, or names no namespace. */
export function parseLibraryManifest(uri: string, source: string): LibraryManifest | undefined {
  if (!normalize(uri).endsWith(".library")) return undefined
  const namespace = /^NAMESPACE[ \t]+(\S.*)$/m.exec(source)?.[1]?.trim()
  // the folder is the one the file sits in — the manifest's own LIBRARY line is the library's TITLE, which may differ
  const folder = normalize(uri).split("/").at(-2)
  const library = /^LIBRARY[ \t]+(\S.*)$/m.exec(source)?.[1]?.trim() ?? ""
  // the DEPENDENCIES line is comma-separated and its own entries may hold commas, so each token is simply matched
  // against the titles seen; one that names no library is ignored rather than guessed at
  const dependencies = (/^DEPENDENCIES[ \t]+(\S.*)$/m.exec(source)?.[1] ?? "").split(",").map((d) => d.trim()).filter((d) => d !== "")
  const materialization = Number(/^MATERIALIZATION[ 	]+(\d+)/m.exec(source)?.[1] ?? 1)
  return namespace === undefined || namespace === "" || folder === undefined ? undefined : { uri, folder, namespace, library, dependencies, materialization }
}

/**
 * Give each manifest's library a namespace scope over the units it materialized. Call after every file is bound.
 * A namespace a project unit already owns is left alone — the project's own name wins, as it does everywhere else.
 */
/** `value` appended to `key`'s list in `map`. */
function file<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

/**
 * The library folders one library can SEE: itself, plus the folders its `DEPENDENCIES` titles name.
 *
 * This is the one definition, and it has two callers for a reason. `bindLibraryNamespaces` needs it to decide
 * which units a namespace scope covers; `linkExtends` needs the SAME answer to decide which `ETRIG` an
 * `EXTENDS ETRIG` inside a library means — and the two must agree, or a name would resolve one way through a
 * namespace and another way through inheritance.
 *
 * DIRECT dependencies only, and that is measured rather than assumed. `scripts/probe-dep-depth.ts` walks the
 * dependency graph breadth-first for every ambiguous reference in the six corpus projects and reports the
 * smallest depth at which the asker reaches a candidate: <b>40 at depth 0 (its own library) and 123 at depth
 * 1 (a declared dependency) — nothing at depth 2 or beyond, and nothing unreachable.</b> So transitivity
 * would be machinery for a case no real project has shown, and inventing a visibility rule the vendor has not
 * been observed to follow is how a resolver starts being confidently wrong.
 */
export function visibleFolders(
  manifests: readonly LibraryManifest[],
  manifest: LibraryManifest,
  byTitle: ReadonlyMap<string, LibraryManifest>,
): Set<string> {
  return new Set(
    [manifest, ...manifest.dependencies.flatMap((d) => byTitle.get(d.toLowerCase()) ?? [])].map((m) =>
      m.folder.toLowerCase(),
    ),
  )
}

/** Manifests keyed by the LIBRARY title other manifests name them by. */
export const manifestsByTitle = (
  manifests: readonly LibraryManifest[],
): Map<string, LibraryManifest> =>
  new Map(manifests.filter((m) => m.library !== "").map((m) => [m.library.toLowerCase(), m]))

export function bindLibraryNamespaces(project: Scope, manifests: readonly LibraryManifest[]): void {
  let added = false
  const byTitle = manifestsByTitle(manifests)
  // WHICH LIBRARY A FILE BELONGS TO IS `libraryOf`'s QUESTION — asked ONCE per file here, not once per manifest per
  // scope and symbol. That was the cost of binding a project: every manifest re-ran the path regex over the whole
  // project, 26 of 37 ms for the fixture project's 31 libraries, and quadratic in the libraries a real project has.
  const libraries = new Map<string, string | undefined>()
  const libOf = (uri: string | undefined): string | undefined => {
    if (uri === undefined) return undefined
    if (!libraries.has(uri)) libraries.set(uri, libraryOf({ uri })?.toLowerCase())
    return libraries.get(uri)
  }
  // only what a library owns can join a namespace: each scope and symbol filed under its library, numbered in the
  // project's own order so a namespace assembled from several libraries keeps it
  let order = 0
  const scopesOf = new Map<string, { child: Scope; order: number }[]>()
  for (const child of project.children) {
    const lib = libOf(child.defUri)
    if (lib !== undefined) file(scopesOf, lib, { child, order: order++ })
  }
  const symbolsOf = new Map<string, { key: string; sym: Symbol; order: number }[]>()
  const own = (key: string, sym: Symbol): void => {
    const lib = libOf(sym.uri)
    if (lib !== undefined) file(symbolsOf, lib, { key, sym, order: order++ })
  }
  for (const [key, syms] of project.symbols) for (const sym of syms) own(key, sym)
  for (const manifest of manifests) {
    const { namespace } = manifest
    if (findChildScope(project, namespace) !== undefined) continue
    // WHICH LIBRARY A FILE BELONGS TO IS `libraryOf`'s QUESTION, and this had its own answer to it: a
    // `/library manager/<folder>/` substring on a whole-path-lowercased URI. Three normalizers for one fact —
    // `isLibrarySymbol`, `libraryOf` and this — with this one requiring a LEADING separator the other two do
    // not, so a repo-relative `Library Manager/Standard/LEN.fun` was a library symbol to both of them and not
    // to this. Live URIs all carry a separator, which is why nothing broke; the disagreement was real anyway.
    const folders = visibleFolders(manifests, manifest, byTitle)
    const byOrder = (a: { order: number }, b: { order: number }): number => a.order - b.order
    const scopes = [...folders].flatMap((f) => scopesOf.get(f) ?? []).sort(byOrder).map((o) => o.child)
    const symbols = new Map<string, Symbol[]>()
    for (const { key, sym } of [...folders].flatMap((f) => symbolsOf.get(f) ?? []).sort(byOrder)) {
      const list = symbols.get(key)
      if (list === undefined) symbols.set(key, [sym])
      else list.push(sym)
    }
    if (scopes.length === 0 && symbols.size === 0) continue
    const span: Span = scopes[0]?.span ?? { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
    const ns = makeScope(project, "namespace", namespace, span)
    ns.children.push(...scopes)
    for (const [key, syms] of symbols) ns.symbols.set(key, syms)
    // the manifest is not ST, so the symbol carries a namespace node standing for it — `units` stays empty, the real
    // ones being `ns.children`, which is where every consumer of a namespace scope reads them
    const ast: Namespace = { kind: "namespace", name: { kind: "identifier", text: namespace, span }, units: [], span }
    const sym: Symbol = { kind: "namespace", name: namespace, span, declarationSpan: span, owner: project, uri: manifest.uri, ast }
    defineSymbol(project, sym)
    // a later namespace that sees this library sees its namespace symbol too, as the whole-project scan did
    own(namespace.toLowerCase(), sym)
    added = true
  }
  // `makeScope` and `defineSymbol` both changed the project's children/symbols — the lazy name index must go
  if (added) project._childIndex = undefined
}
