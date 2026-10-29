/**
 * WHERE A REFERENCED LIBRARY'S FILES LIVE — the `Library Manager/<folder>/` layout `volt pull` materializes a library
 * in. A file format fact (openspec frontend-conformance design.md P8), not a language one.
 */

/**
 * THE PATH A URI NAMES, DECODED. The live server keys every document by its `file://` URI, which a client
 * percent-encodes — a space as `%20`, every character past ASCII as its UTF-8 bytes (a library folder `Bibliothek_Ä`
 * arrives as `Bibliothek_%C3%84`); the corpus and the unit tests key by the raw OS path, which is the path already. A
 * scheme is two or more characters, so a drive letter (`C:\w`) stays the path it is. This is the rule
 * `syntax/format/source-object.ts` reads an object's name by; this layer imports nothing (scripts/check-layering.ts
 * F3), so the library's names read it here. A path that is no valid encoding is no URI a client sends, and
 * `decodeURIComponent` refuses it (URIError) rather than a name being read out of it. Memoized: the library rule is
 * asked per symbol, over a bounded set of documents.
 */
const DECODED = new Map<string, string>()
export function decodedPath(uri: string): string {
  let path = DECODED.get(uri)
  if (path === undefined) {
    path = /^[a-z][a-z0-9+.-]+:/i.test(uri) ? decodeURIComponent(new URL(uri).pathname) : uri
    DECODED.set(uri, path)
  }
  return path
}

/**
 * True when a URI names a referenced-library SIGNATURE (a `Library Manager` folder) rather than
 * project source. A referenced library is a precompiled blob the consuming project never recompiles, so its
 * materialized declarations must NOT be error-checked (they'd false-positive on code CODESYS never builds).
 *
 * Reads the DECODED path (`decodedPath`): the live server keys symbols by `file://` URI (`Library%20Manager`); the
 * corpus and unit tests by raw OS path (`Library Manager`). Matching only the raw form silently disabled the guard
 * under the real LSP. The ONE source of truth for the path rule — do NOT re-inline `.includes("Library Manager")`; the
 * raw match is the exact footgun this replaces.
 */
export function isLibraryUri(uri: string): boolean {
  return decodedPath(uri).includes("Library Manager")
}

/**
 * The referenced library a symbol/URI belongs to — the folder under `Library Manager/` (`Standard`, `Util` …) — or
 * undefined for project source. Read from the decoded path, as `isLibraryUri` is: a library folder named past ASCII is
 * the name the IDE gives it, never its URI's percent-encoding (a workspace symbol's container, the namespace binding,
 * which matches it against its manifest's `folder`).
 */
export function libraryOf(sym: { uri: string }): string | undefined {
  return /Library Manager[\\/]([^\\/]+)[\\/]/.exec(decodedPath(sym.uri))?.[1]
}
