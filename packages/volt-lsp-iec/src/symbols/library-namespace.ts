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
import { defineSymbol, makeScope, type Scope, type Symbol } from "./symbol.js"
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
}

/** A path as the manifest match reads it: forward slashes, decoded spaces, lower case. */
const normalize = (uri: string): string => uri.replace(/%20/g, " ").replaceAll("\\", "/").toLowerCase()

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
  return namespace === undefined || namespace === "" || folder === undefined ? undefined : { uri, folder, namespace, library, dependencies }
}

/**
 * Give each manifest's library a namespace scope over the units it materialized. Call after every file is bound.
 * A namespace a project unit already owns is left alone — the project's own name wins, as it does everywhere else.
 */
export function bindLibraryNamespaces(project: Scope, manifests: readonly LibraryManifest[]): void {
  let added = false
  const byTitle = new Map(manifests.filter((m) => m.library !== "").map((m) => [m.library.toLowerCase(), m]))
  for (const manifest of manifests) {
    const { namespace } = manifest
    if (findChildScope(project, namespace) !== undefined) continue
    const folders = [manifest, ...manifest.dependencies.flatMap((d) => byTitle.get(d.toLowerCase()) ?? [])].map((m) => `/library manager/${m.folder.toLowerCase()}/`)
    const mine = (uri: string | undefined): boolean => uri !== undefined && folders.some((f) => normalize(uri).includes(f))
    const scopes = project.children.filter((child) => mine(child.defUri))
    const symbols = new Map<string, Symbol[]>()
    for (const [key, syms] of project.symbols) {
      const theirs = syms.filter((sym) => mine(sym.uri))
      if (theirs.length > 0) symbols.set(key, theirs)
    }
    if (scopes.length === 0 && symbols.size === 0) continue
    const span: Span = scopes[0]?.span ?? { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
    const ns = makeScope(project, "namespace", namespace, span)
    ns.children.push(...scopes)
    for (const [key, syms] of symbols) ns.symbols.set(key, syms)
    // the manifest is not ST, so the symbol carries a namespace node standing for it — `units` stays empty, the real
    // ones being `ns.children`, which is where every consumer of a namespace scope reads them
    const ast: Namespace = { kind: "namespace", name: { kind: "identifier", text: namespace, span }, units: [], span }
    defineSymbol(project, { kind: "namespace", name: namespace, span, declarationSpan: span, owner: project, uri: manifest.uri, ast })
    added = true
  }
  // `makeScope` and `defineSymbol` both changed the project's children/symbols — the lazy name index must go
  if (added) project._childIndex = undefined
}
