/**
 * WHERE A REFERENCED LIBRARY'S FILES LIVE — the `Library Manager/<folder>/` layout `volt pull` materializes a library
 * in. A file format fact (openspec frontend-conformance design.md P8), not a language one.
 */

/**
 * True when a URI names a referenced-library SIGNATURE (a `Library Manager` folder) rather than
 * project source. A referenced library is a precompiled blob the consuming project never recompiles, so its
 * materialized declarations must NOT be error-checked (they'd false-positive on code CODESYS never builds).
 *
 * Normalizes `%20` FIRST: the live server keys symbols by `file://` URI (`Library%20Manager`); the corpus and
 * unit tests by raw OS path (`Library Manager`). Matching only the raw form silently disabled the guard under
 * the real LSP. The ONE source of truth for the path rule — do NOT re-inline `.includes("Library Manager")`; the raw match is the exact footgun this replaces.
 */
export function isLibraryUri(uri: string): boolean {
  return uri.replace(/%20/g, " ").includes("Library Manager")
}

/**
 * The referenced library a symbol/URI belongs to — the folder under `Library Manager/` (`Standard`, `Util` …) — or
 * undefined for project source. `%20` is normalized first, as in `isLibraryUri`. The transpiler's Standard gate kept
 * its own regex for this (consolidate-lsp-structure C5).
 */
export function libraryOf(sym: { uri: string }): string | undefined {
  return /Library Manager[\\/]([^\\/]+)[\\/]/.exec(sym.uri.replace(/%20/g, " "))?.[1]
}
