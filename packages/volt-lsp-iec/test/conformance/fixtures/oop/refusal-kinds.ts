/**
 * OOP SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec `transpile-refusal-classification` 2.2: FB_Init and the init
 * step's attributes, interfaces, inheritance. Each fixture reaches one refusal site of `lower/diagnostics/codes.ts` that no
 * recording and no corpus POU reached (1.1's table): the vendor says whether the ST is valid and, when it runs, what it
 * does. One question per fixture; the site it asks is in its `feature`.
 */
import type { LanguageTest } from "../../types.js"
import { OOP_REFUSAL_KIND_TESTS_A } from "./refusal-kinds-a.js"
import { OOP_REFUSAL_KIND_TESTS_B } from "./refusal-kinds-b.js"

/**
 * THE LSP GAPS THESE ASKS FOUND (transpile-refusal-classification 2.2): invalid ST CODESYS refuses and the LSP says nothing
 * about, its first error named. Each is niche: accepted loss (0 occurrences in the corpora — every corpus project builds,
 * so none holds invalid ST), each its `deferred.lsp`.
 */
const LSP_GAPS: Readonly<Record<string, string>> = {
  rk_init_slot_method_with_input: "A signature decorated with the 'call_after_global_init_slot' attribute must either have no arguments or a single input named 'bInitRetains'.",
  rk_interface_given_fb_not_implementing: "Cannot convert type 'FB_LANG_rk_igfn_plain' to type 'ITF_LANG_rk_igfn'",
  rk_interface_given_integer: "Cannot convert type 'INT' to type 'ITF_LANG_rk_igi'",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const OOP_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [...OOP_REFUSAL_KIND_TESTS_A, ...OOP_REFUSAL_KIND_TESTS_B].map(withLspGap)
