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

  // NETWORK-TEXT SEMANTIC CHECKS. These are NOT unmapped for want of a code — three of the four have an EXACT
  // catalog entry, and their messages are that entry's wording verbatim:
  //
  //   network-undeclared-identifier -> C0046  Identifier '<name>' not defined
  //   network-unknown-member        -> C0004  '<variable>' is not a component of '<structure>'
  //   network-undefined-label       -> C0117  No such label '<label>' within the scope of the 'JMP' statement
  //
  // What blocks them is the MAP'S SHAPE, not the catalog: `CODESYS_CODE_MAP` is derived from the catalog's
  // `ourCode` field and asserted equal to it (error-catalog.test.ts), which makes it ONE SLUG PER `Cnnnn` — and
  // each of those three codes is already claimed by the ST check these share their resolution logic with
  // (`unresolved-identifier`, `unknown-member`, `jump-label-undefined`). The network checks keep their own slug
  // deliberately: a slug is also the CONFIG SWITCH, and merging them would make "turn off identifier checking in
  // network text" silently turn it off in ST too. Mapping them needs the catalog to carry several slugs per
  // code; until it does, they belong here.
  //
  // `network-unknown-pin` is the one that genuinely has no single code: `pinSet` folds VAR_INPUT, VAR_OUTPUT and
  // VAR_IN_OUT into one set, while CODESYS splits the answer (C0037 for an input, C0038 for an output). Giving
  // it a code means teaching the check which SIDE the pin was on — not picking one of the two here.
  //
  // They were absent from this list not because they were mapped, but because no corpus file had triggered one.
  // The first that did (`Cam_MainDrive` in lenze-mid, a CAM object Volt does not materialize) turned the gate
  // red for a bookkeeping gap rather than the precision gap it was pointing at.
  "network-undeclared-identifier",
  "network-undefined-label",
  "network-unknown-member",
  "network-unknown-pin",
])

/** A code is an allowed wire identity: a compiler code, a network-text code, no code (parse), or a known gap. */
export function allowedCode(code: unknown): boolean {
  if (code === undefined) return true // parse errors ride through without a code
  if (typeof code !== "string") return false
  return /^C\d{4}$/.test(code) || code.startsWith("NETWORK_") || KNOWN_UNMAPPED.has(code)
}
