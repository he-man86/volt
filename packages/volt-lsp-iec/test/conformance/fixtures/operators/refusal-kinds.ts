/**
 * OPERAND SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec `transpile-refusal-classification` 2.2: partial access, a
 * literal no type holds, arguments with no common type. Each fixture reaches one refusal site of
 * `lower/diagnostics/codes.ts` that no recording and no corpus POU reached (1.1's table): the vendor says whether the ST is
 * valid and, when it runs, what it does. One question per fixture; the site it asks is in its `feature`.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec transpile-refusal-classification 2.2"

function fb(name: string, feature: string, source: string): LanguageTest {
  return {
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature,
    fromDoc: doc,
    source,
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
  }
}

/**
 * THE LSP GAPS THESE ASKS FOUND (transpile-refusal-classification 2.2): invalid ST CODESYS refuses and the LSP says nothing
 * about, its first error named. Each is niche: accepted loss (0 occurrences in the corpora — every corpus project builds,
 * so none holds invalid ST), each its `deferred.lsp`. The two partial accesses are `MEASURED_SILENT` in
 * `transpile-replay.test.ts` instead: TwinCAT has no `.%` access and the LSP agrees with it there.
 */
const LSP_GAPS: Readonly<Record<string, string>> = {
  rk_builtin_mixed_types: "Cannot convert type 'BOOL' to type 'TIME'",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const OPERATOR_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [
  fb("rk_partial_access_signed", "`partial-access` (partial-access.ts, a signed source) — `.%B0` of a negative INT",
    `FUNCTION_BLOCK FB_LANG_rk_partial_access_signed
VAR
	i : INT := -2;
	lo : BYTE;
END_VAR
lo := i.%B0;
END_FUNCTION_BLOCK
`),
  fb("rk_partial_access_out_of_range", "`partial-access` (partial-access.ts, past the source's bits) — `.%W1` of a WORD, a second word it has not",
    `FUNCTION_BLOCK FB_LANG_rk_partial_access_out_of_range
VAR
	w : WORD := 16#1234;
	hi : WORD;
END_VAR
hi := w.%W1;
END_FUNCTION_BLOCK
`),
  fb("rk_builtin_mixed_types", "`type-unknown` (promote.ts:93) — MAX of a BOOL and a TIME, arguments with no common type",
    `FUNCTION_BLOCK FB_LANG_rk_builtin_mixed_types
VAR
	b : BOOL := TRUE;
	t : TIME := T#1S;
	res : TIME;
END_VAR
res := MAX(b, t);
END_FUNCTION_BLOCK
`),
].map(withLspGap)
