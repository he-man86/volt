/**
 * THE IDE'S CREATE REFUSAL OF A NAME, as a fixture records it (`LanguageTest.vendorRefuses`): CODESYS "The name 'X' is not
 * valid for this object.", TwinCAT "Creating the child named 'X' is not possible on node (Name mismatch)". Nothing is
 * built for such a fixture, so that sentence is the vendor's whole answer — the oracle the refusals replay
 * (`transpile-replay-refusals.test.ts`) and the diagnostic census (`test/analysis/census-fixtures.ts`) hold the LSP's
 * `object-name-refused` to (openspec lsp-field-followups 3).
 */
import type { Vendor } from "../../../src/analysis/index.js"
import type { LanguageTest } from "../types.js"

const NAME_REFUSAL = /The name '.*' is not valid for this object\.|Creating the child named '.*' is not possible on node \(Name mismatch\)/

/** The vendor's refusal of the fixture's name, word for word — undefined where it refuses nothing, or refuses no name. */
export function nameRefusal(t: LanguageTest, vendor: Vendor): string | undefined {
  return t.vendorRefuses?.[vendor]?.match(NAME_REFUSAL)?.[0]
}
