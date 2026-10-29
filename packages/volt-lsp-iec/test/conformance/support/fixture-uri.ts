/**
 * THE URI A FIXTURE'S ITEM IS READ UNDER — as a client names a workspace file: each path segment percent-encoded, so a
 * fixture whose object is named past ASCII (`FB_主控制`) reaches the LSP as `FB_%E4%B8%BB…`, the way an editor sends it,
 * and the replay asks the decoding every name read from a document's uri goes through (openspec
 * lsp-field-false-positives 8, class 1). An ASCII identifier is its own encoding, so every other fixture's uri is the
 * one it always was.
 */
export const conformanceUri = (...segments: readonly string[]): string =>
  `file:///conformance/${segments.map(encodeURIComponent).join("/")}`
