/**
 * the helpers `execution.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
export interface ExecCase {
  name: string
  /** The body of a VAR block. Initial values are the inputs — the oracle writes no values online. */
  vars: string
  body: string
  /** Scan cycles the body runs. Default 1. */
  cycles?: number
  /** Set when the case must NOT compile: a fragment of CODESYS's error text. Such a case pins the transpiler's input
   *  contract (src/transpile/index.ts) — the transpiler never sees this code, so nothing is run, only the refusal checked. */
  rejects?: string
  /** Set when the case is recorded but its construct is DELIBERATELY refused by decision — the reason, with its date.
   *  The replay reports it as a todo instead of a permanent red that would hide real regressions. */
  deferred?: string
  /** Set when the vendor has no run to record — the reason, with its date (`LanguageTest.execSkip`). */
  execSkip?: string
  /** Set when the LSP does not make the refusal the vendor records — the reason (`LanguageTest.deferred.lsp`). */
  lspDeferred?: string
}

/** Why `record:exec` has nothing for a constant whose fold passes 64 bits (6.A.29). */
export const CONSTANT_PAST_64_BITS =
  "NOTHING TO MEASURE — recorded alone, each, as \"Login failed...\" (CODESYS record:exec 2026-10-10): the build is clean and code generation fails on a CONSTANT whose expression folds past every 64-bit integer of its signedness, so the application never starts; TwinCAT refuses it \"Initialisation of constant variable 'D' not constant\". Its one question is what the build says"
