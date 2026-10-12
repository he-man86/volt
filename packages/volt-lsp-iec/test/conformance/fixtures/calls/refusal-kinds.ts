/**
 * CALL SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec `transpile-refusal-classification` 2.2. Each fixture reaches one
 * refusal site of `lower/diagnostics/codes.ts` that no recording and no corpus POU reached (1.1's table), so the vendor
 * says whether the ST is valid (the code cannot be `invalid`) and, when it runs, what it does (the behaviour is recorded:
 * the code is `not-modelled`, not `not-measured`). One question per fixture; the site it asks is in its `feature`.
 */
import type { LanguageTest } from "../../types.js"
import { doc } from "./refusal-kinds-shared.js"
import { CALL_REFUSAL_KIND_TESTS_A } from "./refusal-kinds-a.js"
import { CALL_REFUSAL_KIND_TESTS_B } from "./refusal-kinds-b.js"

/**
 * THE LSP GAPS THESE ASKS FOUND (transpile-refusal-classification 2.2): invalid ST CODESYS refuses and the LSP says nothing
 * about, its first error named. Each is niche: accepted loss (0 occurrences in the corpora — every corpus project builds,
 * so none holds invalid ST), each its `deferred.lsp`.
 */
const LSP_GAPS: Readonly<Record<string, string>> = {
  rk_inout_other_struct: "Type 'DUT_LANG_rk_ios_b' is not equal to type 'DUT_LANG_rk_ios_a' of VAR_IN_OUT respectively REFERENCE 'rec'",
  rk_builtin_named_args: "Cannot convert type 'Unknown type: 'LIMIT(MN := 0, IN := 7, MX := 5)'' to type 'INT'",
  rk_function_output_bound_with_assign: "Function 'F_LANG_rk_fob_twice' requires exactly '1' inputs",
  rk_program_instance_property_written: "'cell' is no input of 'PRG_LANG_rk_pipw_holder'",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const CALL_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [...CALL_REFUSAL_KIND_TESTS_A, ...CALL_REFUSAL_KIND_TESTS_B].map(withLspGap)

/** A PROGRAM's fixture: PLC_PRG calls it, and its own body is the question. */
export const CALL_REFUSAL_KIND_PROGRAM_TESTS: readonly LanguageTest[] = [
  {
    name: "rk_program_calls_itself",
    pouName: "PRG_LANG_rk_program_calls_itself",
    kind: "program",
    feature: "`call-program` (fb-call.ts) — a PROGRAM whose body calls the PROGRAM itself by name, while a counter is below 3",
    fromDoc: doc,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "PRG_LANG_rk_program_calls_itself();\nseen := PRG_LANG_rk_program_calls_itself.n;",
    source: `PROGRAM PRG_LANG_rk_program_calls_itself
VAR
	n : INT;
END_VAR
n := n + 1;
IF n < 3 THEN
	PRG_LANG_rk_program_calls_itself();
END_IF
END_PROGRAM
`,
  },
]
