/**
 * A REFERENCED LIBRARY'S MANIFEST — `Library Manager/<folder>.library`, which `volt pull` writes beside each library it
 * materializes, naming it:
 *
 *     LIBRARY L_IE1P_ApplicationErrorsTypes
 *     NAMESPACE L_IE1P_Types
 *     RESOLUTION L_IE1P_ApplicationErrorsTypes, 3.32.0.11 (Lenze)
 *
 * The binding of a manifest's namespace over its units is `symbols/library-namespaces.ts`'s.
 */

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
  /** Which materialization wrote the workspace — the manifest's MATERIALIZATION line, 1 when the manifest predates the
   *  line. Different from `MATERIALIZATION`, the files that format wrote mean something else to this server
   *  (`staleLibraryManifests`, `newerLibraryManifests`). */
  materialization: number
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
