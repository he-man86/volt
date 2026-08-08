/**
 * The one source of truth for the diagnostic-code identity invariant, shared by the synthetic behavior test
 * (`diagnostic-identity.test.ts`) and the whole-corpus fold (`test/corpus/corpus.test.ts`).
 *
 * Every wire diagnostic `code` must be a CODESYS `Cnnnn`, a network-text `NETWORK_*`, absent (a parse error), or a
 * semantic slug in KNOWN_UNMAPPED — the checks that don't yet have a catalog `Cnnnn` mapping and so emit
 * their internal slug. This list is the tracked debt: give one of these a catalog `ourCode` and remove it
 * here. Shrink the set, never grow it.
 */
export const KNOWN_UNMAPPED = new Set([
  "abstract-instantiation",
  "call-argument-type",
  "conversion-source-mismatch",
  "external-non-input-write",
  "non-callable-call",
  "subrange-out-of-range",
  "unterminated-conditional-pragma",
])

/** A code is an allowed wire identity: a compiler code, a network-text code, no code (parse), or a known gap. */
export function allowedCode(code: unknown): boolean {
  if (code === undefined) return true // parse errors ride through without a code
  if (typeof code !== "string") return false
  return /^C\d{4}$/.test(code) || code.startsWith("NETWORK_") || KNOWN_UNMAPPED.has(code)
}
