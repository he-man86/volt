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
  // "Recursive definition of constant value" (rule CE5, frontend-conformance 4.6.2): no catalog entry documents its
  // number (the 220 documented codes hold no such sentence; the compiler's resources key it by name only)
  "constant-cycle",
  "conversion-source-mismatch",
  "external-non-input-write",
  "non-callable-call",
  "indexof-removed",
  "subrange-out-of-range",
  "unary-operand-type",
  "unterminated-conditional-pragma",

  // NETWORK-TEXT SEMANTIC CHECKS. These are NOT unmapped for want of a code — two of the three have an EXACT
  // catalog entry, and their messages are that entry's wording verbatim:
  //
  //   network-undeclared-identifier -> C0046  Identifier '<name>' not defined
  //   network-unknown-member        -> C0004  '<variable>' is not a component of '<structure>'
  //
  // What blocks them is the MAP'S SHAPE, not the catalog: `CODESYS_CODE_MAP` is derived from the catalog's
  // `ourCode` field and asserted equal to it (catalog.test.ts), which makes it ONE SLUG PER `Cnnnn` — and
  // each of those codes is already claimed by the ST check these share their resolution logic with
  // (`unresolved-identifier`, `unknown-member`). The network checks keep their own slug
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
  //
  // `network-undefined-label` was a third, and it LEFT this list: the network label checks now emit the ST label
  // check's own slugs (`jump-label-*`, C0116-C0118), because a label is one compiler rule whichever body holds it.
  "network-undeclared-identifier",
  "network-unknown-member",
  "network-unknown-pin",
  // "An inconsistent element has been detected (Missing EN pin)…" (openspec bridge-refusal-review 1.5,
  // `rcc_network_eno_without_en`): a graphical-model message no catalog entry documents a number for — the 220
  // documented codes hold no such sentence, and the recorded build carries none.
  "network-missing-en",
])

/** A code is an allowed wire identity: a compiler code, a network-text code, no code (parse), or a known gap. */
export function allowedCode(code: unknown): boolean {
  if (code === undefined) return true // parse errors ride through without a code
  if (typeof code !== "string") return false
  return /^C\d{4}$/.test(code) || code.startsWith("NETWORK_") || KNOWN_UNMAPPED.has(code)
}
