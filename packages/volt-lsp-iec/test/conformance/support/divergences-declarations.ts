/**
 * THE DECLARATIONS' AND PRAGMAS' KNOWN DIVERGENCES — declaration recovery, VAR_GENERIC, the driver's echo, the
 * conditional pragmas: the fixtures whose recorded answer the LSP does not give, each set with its reason. One concern of
 * `divergences.ts`, which assembles `KNOWN_DIVERGENCES` (openspec lsp-same-standard 4.4).
 */
import type { Vendor } from "../../../src/index.js"
import { TYPE_EXPRESSION_RECOVERY } from "./divergences-units.js"

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — what a vendor says AFTER a declared type it refuses, each one cell and each
 * missing-only (the LSP says the refusal itself, `analysis` declared-type):
 *   `decl_array_reversed_bounds` (CODESYS) — "The variable 'a' is too large. (variable size: 2147483647, …)": the
 *     reversed dimension sized as a negative count;
 *   `decl_subrange_reversed` (TwinCAT) — "Cannot convert type '10' to type 'INT (10..0)'": the subrange's default checked
 *     against it;
 *   `decl_subrange_on_alias` (TwinCAT) — "No matching FB_init method found for instantiation of DUT_…": the refused
 *     parentheses read as FB_Init's arguments;
 *   `decl_array_star_in_function_input`, `decl_array_star_in_method_input` (TwinCAT) — the refused `ARRAY[*]` input typed
 *     on: "Cannot convert type 'ARRAY [0..1] OF INT' to type 'ARRAY[*] OF INT'", "Cannot apply indexing with [] to …",
 *     "Cannot convert type 'Unknown type: 'a[1]''";
 *   `decl_vector_constant_size` (TwinCAT, which has no __VECTOR) — "Cannot convert type 'Unknown type: 'v[2]'' to type
 *     'REAL'" for the undefined vector passed to REAL_TO_INT;
 *   (`decl_array_of_array_comma_index` left 2026-10-06, analysis-conformance 3.1: a literal stored into an ARRAY is typed by
 *     `assignment` now — "Cannot convert type 'SINT' to type 'ARRAY [0..2] OF INT'" — and both vendors agree.)
 * Niche: accepted loss (0 occurrences in the corpora — no reversed bound, subrange of an alias, variable-length input of
 * a function or method on TwinCAT, __VECTOR or comma index into an array of arrays in any of the six).
 */
export const AFTER_A_REFUSED_TYPE: Record<Vendor, readonly string[]> = {
  codesys: ["decl_array_reversed_bounds"],
  twincat: [
    "decl_subrange_reversed",
    "decl_subrange_on_alias",
    "decl_array_star_in_function_input",
    "decl_array_star_in_method_input",
    "decl_vector_constant_size",
  ],
}

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — declaration fixtures whose one disagreement is the vendors' RECOVERY after the
 * first refusal, identical on both: the LSP says that first message and nothing it does not have, and the vendors then
 * resync through the rest of the list in their own way — "',' or ')' expected instead of ':'", "', or ]' expected
 * instead of ':'", "';, := or REF=' expected instead of 'END_VAR'", "'END_VAR' expected instead of ''" after a bracket
 * list without `:=` (`decl_bracket_init_no_assign`, `_scalar`, `decl_struct_field_bracket_init`: "'(' expected instead
 * of '1'"); "';' expected instead of 'accF'" … "';' expected instead of end of POU" after a VAR_ACCESS section in a POU
 * (`decl_var_access_in_fb`: "Unexpected token 'VAR_ACCESS' found"); "'END_STRUCT' expected instead of 'END_VAR'" after
 * a VAR_ACCESS or VAR_GENERIC inside a STRUCT, where the LSP's own recovery says "unterminated STRUCT" (an LSP-only
 * message, left standing — an error where the build fails — until the recovery is the vendors'). Task 2.8.2.
 */
export const DECLARATION_RECOVERY: readonly string[] = [
  "decl_bracket_init_no_assign",
  "decl_bracket_init_no_assign_scalar",
  "decl_struct_field_bracket_init",
  "decl_var_access_in_fb",
  "decl_var_access_inside_struct",
  "decl_var_generic_inside_struct",
  ...TYPE_EXPRESSION_RECOVERY,
]

// (`LITERAL_ONE_IS_BIT` closed 2026-10-06, analysis-conformance 3.1: into a struct, a function block or an array an untyped
// 0 or 1 is BIT, any other integer its own type — `litc_*`, ten cells on both vendors; `types/literal` `literalErrorType`.)

/**
 * FRONTEND-CONFORMANCE 2.3.5 (2026-10-01) — a VAR_EXTERNAL section inside a STRUCT: both vendors refuse the section as the
 * LSP does, and then still look its declaration up among the globals: "No global definition found for VAR_EXTERNAL a".
 * The LSP refuses the section at parse and binds nothing from it, so no global lookup runs. Niche: accepted loss (0
 * occurrences in the corpora — they hold no VAR_EXTERNAL at all; frontend-conformance 3.1.3 counted).
 */
export const EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION: readonly string[] = ["decl_var_external_inside_struct"]

/*
 * (`GVL_MEMBER_NOT_DECLARED` — `decl_non_retain_in_gvl` — left 2026-10-02, frontend-conformance 3.1.3: `GVL.gNr`, a member the
 * list does not declare, is "'gNr' is no component of 'GVL_…'" with its conversion, as both vendors say (rule Y9,
 * `analysis/resolution` `checkMember`). TwinCAT keeps its NON_RETAIN recovery mark.)
 */

/**
 * FRONTEND-CONFORMANCE 2.3.4 (2026-10-01) — `[K+L(7)]` with K, L constants: the parser reads `L(7)` as L's call, as both
 * vendors do (`parse/initializer`), and the vendors then refuse the call — "Program name, function or function block
 * instance expected instead of 'L'" and "Unknown type: 'L(7)'". The LSP's call check and its hole rule walk BODIES and a
 * scalar initializer, not an aggregate's elements: the calls check's (`analysis` non-callable-call, unknown-source), outside
 * the front-end — the LSP review.
 */
export const CALL_IN_AN_AGGREGATE_INITIALIZER: readonly string[] = ["decl_repeat_count_expression_names"]

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — TwinCAT's recovery after "',, AT or :' expected instead of 'k'" (a NAME after
 * the name NON_RETAIN): it goes on to "Type definition expected instead of 'END_VAR'", and in a GVL "'END_VAR' expected
 * instead of ''". CODESYS stops at the first, and the LSP agrees with CODESYS on all four. Task 2.8.2.
 */
export const TWINCAT_NON_RETAIN_RECOVERY: readonly string[] = [
  "var_non_retain",
  "decl_non_retain_in_gvl",
  "decl_non_retain_in_var_input",
  "decl_retain_non_retain",
]

/**
 * FRONTEND-CONFORMANCE 2.3.1 (2026-10-01) — TwinCAT has no VAR_GENERIC: it reads the word as a declaration's NAME, and
 * the LSP lexes it as an identifier there too (`CODESYS_ONLY_KEYWORDS`). What each then says about the rest of the POU is
 * the declaration-area recovery (TwinCAT: "VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of VAR_GENERIC:;",
 * the LSP: its statement cascade) — task 2.8.2. That recovery is ALL this mark holds: the consumer's `inst : FB<6>;` is
 * refused by both at its `<` ("';, :=, REF=, ( or [' expected instead of '<'", `parse/declarations` `endAfterType`,
 * frontend-conformance 2.3a), so a fixture here agrees on that line and differs in the FB's own.
 */
export const TWINCAT_NO_VAR_GENERIC: readonly string[] = [
  "decl_var_generic",
  "decl_var_generic_no_argument",
  "decl_var_generic_no_constant",
  "decl_var_generic_read",
  "decl_var_generic_two_values",
  "decl_var_generic_in_array",
  "decl_var_generic_in_array_no_argument",
  "decl_var_generic_in_array_two_values",
  // …and the two of analysis-conformance 3.7 (two constants given one value; a VAR_INPUT of the FB's type), whose
  // TwinCAT recovery goes on to type the body's `N`/`K` as names nothing declares
  "oopb_generic_two_constants_one_value",
  "oopb_generic_as_input",
]

/**
 * FRONTEND-CONFORMANCE 2.3.5 (2026-10-01) — the TwinCAT RECORDING is cut, not the behaviour, as for `op_sys_varinfo`: the
 * echo of a VAR section inside a STRUCT is stored as "Variable declaration expected instead of VAR", where CODESYS stores
 * the whole message with the lines it quotes. The TwinCAT driver cuts a message at its first line break — a BRIDGE bug
 * to fix and re-record, not something for the LSP to match. Every placement message before the echo agrees.
 */
export const TWINCAT_DRIVER_CUTS_THE_ECHO: readonly string[] = [
  // …and the section an unclosed VAR section meets, read back the same way (`rec_unterminated_var_before_section`, 2.8)
  "rec_unterminated_var_before_section",
  "decl_var_inside_struct",
  "decl_var_inside_struct_init",
  "decl_var_inside_struct_names",
  "decl_var_input_inside_struct",
  "decl_var_output_inside_struct",
  "decl_var_in_out_inside_struct",
  "decl_var_temp_inside_struct",
  "decl_var_stat_inside_struct",
  "decl_var_inst_inside_struct",
  "decl_var_global_inside_struct",
  "decl_var_config_inside_struct",
  // …and VAR_EXTERNAL's, recorded cut the same way ("… instead of VAR_EXTERNAL"); its other divergence, the global lookup
  // the vendors still run, is EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION's (analysis-conformance 1a+1c review)
  "decl_var_external_inside_struct",
]

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — CODESYS-only:
 *   `decl_nested_aggregate` — `ARRAY[0..1, 0..1] OF INT := [[1, 2], [3, 4]]`: CODESYS SP21's compiler THROWS
 *     ("Internal error:System.NullReferenceException …" and its stack); TwinCAT says "Unexpected array initialisation",
 *     which the LSP says on both. A vendor crash is no rule to conform to. Accepted.
 *   `decl_bracket_init_no_assign_fb` — `fbs : ARRAY[0..1] OF FB [(x := 1), (x := 2)]` passes each element's list to the
 *     FB's FB_Init, which this FB does not declare: "No matching 'FB_Init' method found for instantiation of FB_…"
 *     (TwinCAT records a failed build with no message). The FB_Init matching (`analysis` fb-init-instantiation, outside the front-end; the LSP review), which the grammar now reaches.
 */
export const CODESYS_DECLARATION_DIVERGENCES: readonly string[] = ["decl_nested_aggregate", "decl_bracket_init_no_assign_fb"]

/**
 * FRONTEND-CONFORMANCE 2.7 (2026-10-02) — pragma cells the LSP does not reproduce, each NICHE: ACCEPTED LOSS.
 *   `prag_attribute_brace_in_value` (both) — a `}` inside a quoted attribute ends the pragma on both vendors (the lexer
 *        agrees), and the rest of the line opens a string that runs to the end of the DECLARATION part: both echo it
 *        whole ("',, AT or :' expected instead of ''}\r\n\tv : INT;…END_VAR\r\n'"), TwinCAT adds "Type definition
 *        expected". The LSP reads one text, so its string and its recovery end elsewhere. 0 occurrences in the corpora.
 *   `prag_project_defined_in_declaration` (both), `prag_project_defined_not_in_declaration` (TwinCAT) — `{IF
 *        project_defined (X)}` around a declaration: CODESYS drops the declaration when X is not set, TwinCAT (which has
 *        no `project_defined`) drops it either way. The declaration parser applies no conditional pragma. 0 occurrences.
 *   `prag_project_defined_forbidden_construct` (CODESYS) — a whole VAR block under `project_defined`: "The condition
 *        'project_defined' is not supported for this syntax …" and the declaration part's `{IF}` unterminated; the LSP
 *        says only the body's orphan `{END_IF}` (as TwinCAT does). 0 occurrences.
 *   `prag_if_defined_in_declaration` (CODESYS) — any other `{IF}` in a declaration part is "This code is not supported
 *        in declaration part" (TwinCAT builds it). 0 conditional directives in any declaration part of the corpora.
 *   `prag_hasattribute_unquoted_in_declaration` (both) — an `{IF hasattribute (pou: F, x)}` with the attribute unquoted
 *        in a VAR section: CODESYS adds "This code is not supported in declaration part" to the unquoted-attribute error,
 *        TwinCAT builds it clean (it checks the operand only in a body); the LSP's out-of-body scan says the attribute
 *        error on both. Niche: accepted loss (0 occurrences in the corpora — no `hasattribute` at all).
 *        `dead_method_hasattribute_unquoted` (analysis-conformance 2.5) is the same shape in a method NOTHING CALLS, and
 *        both vendors answer exactly as they do for the live one: CODESYS reports it in the dead member too (so the
 *        server keeps C0051 there, `src/analysis/pipeline/document.ts`), TwinCAT builds it clean. Same accepted loss.
 */
export const PRAGMA_DIVERGENCES: readonly string[] = ["prag_attribute_brace_in_value", "prag_project_defined_in_declaration", "prag_hasattribute_unquoted_in_declaration", "dead_method_hasattribute_unquoted"]

/**
 * ANALYSIS-CONFORMANCE 2.5 (recorded 2026-10-06) — A POU NOTHING REACHES IS NOT EVEN PARSED BY THE BUILD. An FB no
 * PROGRAM instantiates, holding a statement parse error (`dead_fb_missing_then`) or a declaration parse error
 * (`dead_fb_declaration_parse_error`), builds CLEAN on both vendors: the compiler reports no syntax error in code it
 * does not compile. (A method nothing calls inside a LIVE FB is different: its parse errors ARE reported on both —
 * `dead_method_missing_then`, `sig_empty_type` — and agree.) The replay analyses each fixture's file with no
 * reachability, so it reports the parse error the build did not; the SERVER suppresses it (`diagnoseDeadCode` off,
 * `src/analysis/pipeline/document.ts`, tested in `src/analysis/pipeline/document.test.ts`). Not a check to change: the replay has no
 * reachability, the same cause as `sn_dut_mismatch` and `cc2_var_in_interface`.
 */
export const DEAD_POU_NOT_IN_THE_REPLAY: readonly string[] = ["dead_fb_missing_then", "dead_fb_declaration_parse_error"]
export const CODESYS_PRAGMA_DIVERGENCES: readonly string[] = ["prag_project_defined_forbidden_construct", "prag_if_defined_in_declaration"]
export const TWINCAT_PRAGMA_DIVERGENCES: readonly string[] = ["prag_project_defined_not_in_declaration"]
