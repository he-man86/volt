/**
 * the ceiling exceptions (`baseline.ts`) — part A.
 *
 * One slice of `baseline.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
import { ANALYSIS_NICHE_WHY, CONDITION_TYPE_TASK, CONDITION_TYPE_WHY, CeilingException, DEAD_CODE_TASK, DEAD_CODE_WHY, LIB_REFERENCE_FACTS, LITERAL_TYPING, METHOD_NAME_VALUE_WHY, NEGATED_LITERAL_CELLS, NEGATED_LITERAL_ROWS, SECTION_ECHO, SECTION_ECHO_ROWS, TWO_LIBRARIES_ERROR, TYPE_NAME_VALUE_TASK, TYPE_NAME_VALUE_WHY, UNTYPED_CALL_CELLS, UNTYPED_CALL_ROWS } from "./baseline-shared.js"

export const CEILING_EXCEPTIONS_A: readonly CeilingException[] = [
// (the `s[i]` rows of transpile-restructure 3.1's string-model fixtures left 2026-10-11, lsp-transpile-review-gaps 2.3: a
  // STRING's unit is typed, a BYTE / a WSTRING's a WORD, `infer/expr`)
  ...UNTYPED_CALL_ROWS.flatMap(([fixture, kind]) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind} UNKNOWN`,
      by: 1,
      fixture,
      task: LITERAL_TYPING,
      why: UNTYPED_CALL_CELLS,
    })),
  ),
  ...NEGATED_LITERAL_ROWS.flatMap(([fixture, by]) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`,
      by,
      fixture,
      task: LITERAL_TYPING,
      why: NEGATED_LITERAL_CELLS,
    })),
  ),
  // (the FOR-bound exceptions — `n := n + 1` in `lt_literal_for_bounds`, `_out_of_range` and `cc6_loop_cannot_exit` — left
  // 2026-10-03: an operation on an untyped literal takes its neighbour's type since frontend-conformance 4.3.1, `arith/checked`
  // `literalOperandType`)
  // (the ADR exceptions — `ty_array_of_pointer` and 3.5's pointer cells `mem_*_pointer_*` — left 2026-10-03: ADR is
  // POINTER TO its operand's type since frontend-conformance 4.3.4, so their calls are typed)
  { baseline: "resolution-dump", measure: "findings", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  // an ALIAS's type expression was NOSCOPE until frontend-conformance 4.7.4 placed it in the project its file sees (rule DT1,
  // `dumps.ts` `sites`): of pro2193's three library aliases bounded by a GVL constant (`ARRAY [1..GVL_Dashboard.
  // LogQueueLength] OF LogRecord`, BrinkEdgePcLogging), one constant is a platform integer, which on a corpus whose target
  // nobody measured is UNKNOWN — the same expression, moved from NOSCOPE (−3) into the TY6 class (+1)
  {
    baseline: "type-dump",
    measure: "corpus Library Manager: member UNKNOWN, a platform integer on a target nobody measured (TY6)",
    by: 1,
    fixture: "(corpus) pro2193 BrinkEdgePcLogging LOGRECORDARRAY.dut",
    task: "a measured target for each corpus (`workspace-refs` `MEASURED_DEVICE_TARGETS`)",
    why: "an alias's bound read in the project scope (frontend-conformance 4.7.4) — a NOSCOPE expression typed as far as an unmeasured target allows",
  },
  { baseline: "resolution-dump", measure: "fixtures codesys: member NONE", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  { baseline: "type-dump", measure: "fixtures codesys: member UNKNOWN", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  // the diagnostic census: a VAR section inside a STRUCT is echoed by `parse-errors` through a NAMED builder since
  // analysis-conformance 1.11 (`variableDeclarationExpectedInsteadOf`, an inline template before), so the gap against
  // TwinCAT's CUT recording of that echo (divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO: the driver drops everything after
  // the message's first line break) is attributed to the syntax group instead of `unowned` (unowned GAP 115 → 104, group
  // syntax GAP 70 → 81): the same eleven recorded messages, moved between classes, no diagnostic changed. The fix is the
  // BRIDGE's and a re-record, never the LSP matching the cut text; each exception goes when its fixture is re-recorded.
  ...SECTION_ECHO_ROWS.map((fixture) => ({
    baseline: "fixtures.twincat",
    measure: "group syntax: GAP",
    by: 1,
    fixture,
    task: "the TwinCAT driver: keep a message whole past its first line break, then re-record these fixtures (divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO)",
    why: SECTION_ECHO,
  })),
  // the diagnostic census: analysis-conformance gate 2 RECORDED what the server does with parse errors in dead code
  // (`fixtures/grammar/dead-code.ts`). The two dead-FB fixtures build clean on both vendors — the build never reads a POU
  // nothing reaches — while the census, analysing each fixture's file as the replay does, has no reachability and counts
  // their parse error as FP(div) (divergences.ts DEAD_POU_NOT_IN_THE_REPLAY; the SERVER suppresses it, src/server/
  // diagnostics.test.ts). The dead-method `hasattribute` fixture repeats `prag_hasattribute_unquoted_in_declaration`'s
  // accepted loss in a method nothing calls (CODESYS's extra "not supported in declaration part" GAP, TwinCAT's silence
  // FP(div)). New ground measured, not a regression: no existing finding changed.
  ...(["dead_fb_missing_then", "dead_fb_declaration_parse_error"] as const).flatMap((fixture) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: `fixtures.${vendor}`,
      measure: "total: FP",
      by: 1,
      fixture,
      task: DEAD_CODE_TASK,
      why: DEAD_CODE_WHY,
    })),
  ),
  // analysis-conformance 3.1 measured a POINTER compared with a SIGNED integer: both vendors meet the two at LINT and warn
  // the pointer's change of sign (`cmpop_pointer_vs_*`). The analysis says so (`types/compat` `pointerComparison`); the
  // front-end's type model has no meet of a pointer and an integer, so the bound census finds no store it types POINTER TO
  // INT → LINT. New ground measured, not a regression.
  // `cmpop_pointer_vs_xint` (the 3.1+3.3 gate review) is the same meet, an __XINT being LINT on the 64-bit target.
  ...(["cmpop_pointer_vs_lint", "cmpop_pointer_vs_sint", "cmpop_pointer_vs_int_ordered", "cmpop_pointer_vs_xint"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 1,
    fixture,
    task: "the front-end's meet of a pointer and an integer (`arith/checked` `checkedMeetType`), which `pointerComparison` states for the analysis",
    why: "a comparison's pointer–integer meet, measured 2026-10-06 (analysis-conformance 3.1), that the type model does not carry",
  })),
  // …and `rec : S := (1)` (`litc_struct_init_one_in_parens`): an untyped literal in parentheses whose context is a STRUCT has
  // no type of its own — the analysis names it BIT as the vendors do (`types/literal` `literalErrorType`), the type dump
  // counts the parenthesis UNKNOWN, as it does every context-typed literal it cannot place
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: paren UNKNOWN`,
    by: 1,
    fixture: "litc_struct_init_one_in_parens",
    task: LITERAL_TYPING,
    why: "a parenthesized untyped literal stored into a STRUCT (analysis-conformance 3.1) — context-typed, with no elementary context",
  })),
  // analysis-conformance 3.2 measured an array initializer against its declared type (`fixtures/declarations/array-init-
  // shapes.ts`): each scalar where an ARRAY OF ARRAY or an ARRAY OF a struct needs a list converts into the element type
  // ("Cannot convert type 'SINT' to type 'ARRAY [0..1] OF INT'"), and an array literal on a scalar or a struct is "Cannot
  // convert type 'Unknown type: '[1, 2]'' …". The analysis says so (`array-init`); the bound census finds no store the
  // front-end types for an aggregate's element. New ground measured, not a regression.
  ...(
    [
      ["arrinit_flat_into_nested", 6],
      ["arrinit_scalar_into_struct_array", 4],
      ["arrinit_on_scalar", 2],
      ["arrinit_on_struct", 2],
    ] as const
  ).map(([fixture, by]) => ({
    baseline: "type-dump",
    measure: "findings",
    by,
    fixture,
    task: "the front-end's stores of an aggregate initializer's elements (the bound census reads assignments and initial values)",
    why: "an array initializer's element conversions, measured 2026-10-06 (analysis-conformance 3.2), that the bound census does not see as stores",
  })),
  // (the duplicate enum values — `eninit_real_literal`, `_string_literal`, `_bool_literal`, `_gvl_variable`,
  // `_explicit_duplicate`, one unowned GAP each per vendor — left 2026-10-06: analysis-conformance 3.11 gave the rule a
  // check, C0125 in `types/enum-init`.) …which owns the warning now where it stays a GAP: `lit_char_typed_in_enum_value`
  // (CODESYS), whose two members CODESYS refuses as `CHAR#'null'` and `(CHAR#'null' + 1)` — both 0, so the warning — where the
  // LSP reads `'A' is no component of 'CHAR'` and refuses neither (COMPONENT_CARRIED_ON_IN_A_DUT, a known divergence). The
  // same GAP, moved from `unowned` (−1) into the types group (+1). New attribution, not a regression.
  {
    baseline: "fixtures.codesys",
    measure: "group types: GAP",
    by: 1,
    fixture: "lit_char_typed_in_enum_value",
    task: "none planned — the divergence COMPONENT_CARRIED_ON_IN_A_DUT (niche: accepted loss, frontend-conformance)",
    why: "the duplicate-value warning attributed to `enumDuplicateValue` since analysis-conformance 3.11, on a fixture the LSP reads otherwise",
  },
  // the 3.11 gate review asked an ALIAS of REFERENCE TO BIT (`types/missing-rules.ts`): "References to bits are not
  // possible" once a variable of the alias exists — CODESYS three times without a position, TwinCAT once at the alias —
  // which the reference rule does not say (REFERENCE_TO_BIT_ALIAS, a known divergence). New ground measured, not a
  // regression.
  ...(
    [
      ["fixtures.codesys", "refbit_alias", 3],
      ["fixtures.codesys", "refbit_alias_variable_unread", 3],
      ["fixtures.twincat", "refbit_alias", 1],
      ["fixtures.twincat", "refbit_alias_variable_unread", 1],
    ] as const
  ).flatMap(([baseline, fixture, by]) =>
    ["group declarations: GAP", "total: GAP"].map((measure) => ({
      baseline,
      measure,
      by,
      fixture,
      task: "none planned — the divergence REFERENCE_TO_BIT_ALIAS (niche: accepted loss, 0 REFERENCE TO BIT in the corpora)",
      why: "an alias of REFERENCE TO BIT with a variable of it, measured 2026-10-06 (the analysis-conformance 3.11 gate review)",
    })),
  ),
  // analysis-conformance 3.12 asked the initialization order of PROGRAMs (`fixtures/cross-object/init-order.ts`): TwinCAT
  // refuses an initializer reading a program initialized later — once per late read — which no check says
  // (INIT_ORDER_OF_PROGRAMS, a known divergence: the order is the tasks' call order, a whole-project fact, and CODESYS says
  // it only at code generation). New ground measured, not a regression.
  ...(
    [
      ["initord_reads_later_name", 1],
      ["initord_reads_later_name_declared_second", 1],
      ["initord_slot_on_read", 1],
      ["initord_array_later_name", 1],
      ["initord_interface_var_later_name", 1],
      ["initord_read_uninitialized", 1],
      ["initord_read_type_default", 1],
      ["initord_value_later_name", 1],
      ["initord_chain3_asc", 2],
      ["initord_chain4_asc", 3],
      ["initord_chain5_asc", 4],
      ["initord_same_block_later_instance", 1],
    ] as const
  ).flatMap(([fixture, by]) =>
    ["total: GAP", "total: unowned GAP"].map((measure) => ({
      baseline: "fixtures.twincat",
      measure,
      by,
      fixture,
      task: "none planned — the divergence INIT_ORDER_OF_PROGRAMS (analysis-conformance 3.12: the tasks' call order, and CODESYS's code generation)",
      why: "an initializer reading a PROGRAM initialized later, measured 2026-10-07 (analysis-conformance 3.12)",
    })),
  ),
  // transpile-restructure 6.A.29 (step 6Af): a CONSTANT whose expression folds past every 64-bit integer of its signedness
  // (`tr_a29_lint_constant_expression_overflow`, `_ulint_…`, `_dint_constant_overflow_past_lint`) — TwinCAT refuses it, and
  // every constant that names it, "Initialisation of constant variable 'D' not constant"; CODESYS builds it and fails to
  // generate code (no message). The LSP says nothing: niche: accepted loss (0 occurrences in the corpora — such a constant
  // cannot run on either vendor). New ground measured, not a regression.
  ...(
    [
      ["tr_a29_lint_constant_expression_overflow", 2],
      ["tr_a29_ulint_constant_expression_overflow", 1],
      ["tr_a29_dint_constant_overflow_past_lint", 1],
    ] as const
  ).map(([fixture, by]) => ({
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by,
    fixture,
    task: "none planned — niche: accepted loss (0 occurrences in the corpora): TwinCAT's refusal of a CONSTANT folding past 64 bits",
    why: "a CONSTANT whose expression folds past 64 bits, measured 2026-10-10 (transpile-restructure 6.A.29)",
  })),
  // the diagnostic census: analysis-conformance 3.3 asked a BIT in every FB section (`fixtures/declarations/declaration-
  // rules.ts`). (In a VAR_IN_OUT CODESYS adds "References to bits are not possible" — its unowned GAP left 2026-10-06,
  // analysis-conformance 3.11: `bit-usage` says it.) And a FUNCTION called with no argument whose one input's default CODESYS refuses
  // (not constant) is "requires exactly '1' inputs" there (`callarg_no_argument_variable_default`, MEASURED_SILENT in transpile-replay.test.ts):
  // the call check reads only that a default is written, the calls group's to refine (3.8) — one calls GAP. New ground
  // measured, not a regression.
  // …and `b : BIT := 1` in a VAR CONSTANT (`bitu_fb_var_constant`, legal on both): one more literal of LT14's existing class
  // "into BIT — transpiler SINT, checker BIT", the transpiler's context literal type (task 5.3)
  {
    baseline: "literal-agreement",
    measure: "fixtures: literals the two disagree on",
    by: 1,
    fixture: "bitu_fb_var_constant",
    task: LITERAL_TYPING,
    why: "a BIT constant initialized with 1 (analysis-conformance 3.3) — LT14's class 'into BIT', one literal more",
  },
  // (`callarg_no_argument_variable_default`'s two left 2026-10-06, analysis-conformance 3.8: a VARIABLE default leaves a
  // FUNCTION input required on CODESYS, `call-arguments` says so.)
  // analysis-conformance 3.4 asked an FB instance initialized with a LITERAL for its VAR_IN_OUT (`ioinit_fb_instance_literal`):
  // both vendors convert the value into the parameter's REFERENCE ("Cannot convert type 'SINT' to type 'REFERENCE TO INT'",
  // TwinCAT the pair reversed). The bound census reads assignments and initial values, not an FB initializer's fields as
  // stores — one finding per vendor. New ground measured, not a regression.
  {
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture: "ioinit_fb_instance_literal",
    task: "the front-end's stores of an FB instance initializer's fields (the bound census reads assignments and initial values)",
    why: "an FB initializer's VAR_IN_OUT field given a literal, measured 2026-10-06 (analysis-conformance 3.4) — a store the bound census does not see",
  },
  // the diagnostic census: analysis-conformance 3.4 asked an access modifier on a FUNCTION and on a PROGRAM (`fixtures/
  // declarations/declaration-rules-b.ts`, divergences.ts ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM, niche): the LSP's header
  // grammar refuses the word and loses the unit (its parse errors and the call's fallout, FP(div)), where both vendors
  // take the header and give the access message (a declarations GAP) and "Cannot access private method ???.F" at the call
  // (unowned: the access rule family, 3.11's). New ground measured, not a regression.
  ...(
    [
      ["hdr_function_private", 5],
      ["hdr_program_protected", 4],
    ] as const
  ).flatMap(([fixture, fp]) =>
    (["codesys", "twincat"] as const).flatMap((vendor) =>
      (
        [
          ["total: FP", fp],
          ["total: GAP", 2],
          ["total: unowned GAP", 1],
        ] as const
      ).map(([measure, by]) => ({
        baseline: `fixtures.${vendor}`,
        measure,
        by,
        fixture,
        task: "none planned — niche: accepted loss (analysis-conformance 3.11): the access rule family (\"Cannot access private method …\", MEMBER_DIVERGENCES), and a header grammar that takes an access modifier on a FUNCTION or a PROGRAM",
        why: "an access modifier on a FUNCTION / PROGRAM, measured 2026-10-06 (analysis-conformance 3.4) — niche: accepted loss (0 in the corpora)",
      })),
    ),
  ),
  // …and an ARRAY / STRUCT initializer reading the FB's own VAR_IN_OUT (`ioinit_array_initializer`, `_struct_`): CODESYS
  // records the uninitialized-access warning TWICE there (TwinCAT once); inout-initializer says it once. (The external
  // access from FB_INIT and the FB instance's conversion into the REFERENCE are said since 3.6.)
  ...(["ioinit_array_initializer", "ioinit_struct_initializer"] as const).map((fixture) => ({
    baseline: "fixtures.codesys",
    measure: "total: GAP",
    by: 1,
    fixture,
    task: "none planned: CODESYS repeats the warning for an aggregate initializer (FB_INIT), TwinCAT does not — said once",
    why: "an aggregate initializer reading a VAR_IN_OUT, measured 2026-10-06 (analysis-conformance 3.4)",
  })),
  // analysis-conformance 3.5 asked a TYPE's name as a value (`fixtures/names/name-rules.ts` `tav_*`): both vendors type it
  // as the type itself — "Operation 'Plus' is not possible on type 'T'", "Cannot convert type 'T' to type 'BOOL'" — where
  // the front-end has no value type for a type's name (an ALIAS's is UNKNOWN; the enum's and struct's are its scope). C0230
  // is said; the conversions are a niche divergence (0 in the corpora, which build). New ground measured, not a regression.
  ...(["tav_alias_as_value", "tav_alias_as_target", "tav_type_as_operand"] as const).flatMap((fixture) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ident_expr UNKNOWN`,
      by: 1,
      fixture,
      task: TYPE_NAME_VALUE_TASK,
      why: TYPE_NAME_VALUE_WHY,
    })),
  ),
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: binary UNKNOWN`,
    by: 1,
    fixture: "tav_type_as_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  // (the census attributes "Operation 'Plus' is not possible on type 'T'" to the one check that says that wording, the calls
  // group's intrinsic-operands)
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: `fixtures.${vendor}`,
    measure: "group calls: GAP",
    by: 1,
    fixture: "tav_type_as_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  ...(["tav_type_as_operand", "tav_type_as_condition"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture,
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  // …and a global two lists declare as an IF condition (`ambg_in_condition`): both vendors add "Expression of type 'BOOL'
  // expected in this place" for the hole the name leaves — no catalog code, 0.2's missing-rule class (3.11's, as for
  // `enum_same_member_comparison`); the parse census classes the wording as a syntax message
  ...(["codesys", "twincat"] as const).flatMap((vendor) => [
    {
      baseline: "parse-census",
      measure: `fixtures ${vendor}: refused with a syntax message, no LSP parse error`,
      by: 1,
      fixture: "ambg_in_condition",
      task: CONDITION_TYPE_TASK,
      why: CONDITION_TYPE_WHY,
    },
    {
      baseline: `fixtures.${vendor}`,
      measure: "total: unowned GAP",
      by: 1,
      fixture: "ambg_in_condition",
      task: CONDITION_TYPE_TASK,
      why: CONDITION_TYPE_WHY,
    },
  ]),
  { baseline: "parse-census", measure: "findings", by: 2, fixture: "ambg_in_condition", task: CONDITION_TYPE_TASK, why: CONDITION_TYPE_WHY },
  // analysis-conformance 3.6: an FB instance's VAR_IN_OUT field given a BOOL variable (`oopa_fb_init_inout_other_type`) —
  // the same store the bound census does not see as `ioinit_fb_instance_literal`'s — and a METHOD named without its call as
  // an operand (`oopa_method_ref_in_operand`, deferred niche): both vendors type it as a type of its own name ('VALUE'),
  // which the front-end has no value type for, so the operation is UNKNOWN. New ground measured, not a regression.
  {
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture: "oopa_fb_init_inout_other_type",
    task: "the front-end's stores of an FB instance initializer's fields (the bound census reads assignments and initial values)",
    why: "an FB initializer's VAR_IN_OUT field given a variable of another type, measured 2026-10-06 (analysis-conformance 3.6)",
  },
  { baseline: "type-dump", measure: "findings", by: 2, fixture: "oopa_method_ref_in_operand", task: TYPE_NAME_VALUE_TASK, why: METHOD_NAME_VALUE_WHY },
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["group calls: GAP", 1],
        ["total: GAP", 2],
      ] as const
    ).map(([measure, by]) => ({ baseline: `fixtures.${vendor}`, measure, by, fixture: "oopa_method_ref_in_operand", task: TYPE_NAME_VALUE_TASK, why: METHOD_NAME_VALUE_WHY })),
  ),
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: binary UNKNOWN`,
    by: 1,
    fixture: "oopa_method_ref_in_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: METHOD_NAME_VALUE_WHY,
  })),
  // analysis-conformance 3.7–3.9: the rule cells of oop B, calls and flow whose answer the LSP does not give — each a
  // NICHE divergence or a named GAP (tasks.md 3.7.4, 3.8.4, 3.9.4; `support/divergences.ts` ANALYSIS_NICHE,
  // TWINCAT_NO_VAR_GENERIC). New ground measured, not a regression: every count below is one fixture's own findings.
  ...(
    [
      ["codesys", "oopb_abstract_pointer_deref_assign", { "total: GAP": 2, "group oop: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.deref],
      ["twincat", "oopb_abstract_pointer_deref_assign", { "total: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.deref],
      ["codesys", "oopb_abstract_method_output_default", { "total: GAP": 1, "group oop: GAP": 1 }, ANALYSIS_NICHE_WHY.outputDefault],
      ["codesys", "oopb_implicit_abstract_output_default", { "total: GAP": 2, "group oop: GAP": 2 }, ANALYSIS_NICHE_WHY.outputDefault],
      ["twincat", "oopb_generic_two_constants_one_value", { "total: FP": 20, "total: GAP": 10, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.generic],
      ["twincat", "oopb_generic_as_input", { "total: FP": 15, "total: GAP": 8, "total: unowned GAP": 2, "group syntax: GAP": 2 }, ANALYSIS_NICHE_WHY.generic],
      ["codesys", "calls_method_recursive", { "total: FP": 2, "total: GAP": 2 }, ANALYSIS_NICHE_WHY.recursion],
      ["twincat", "calls_method_recursive", { "total: FP": 2, "total: GAP": 2 }, ANALYSIS_NICHE_WHY.recursion],
      ["codesys", "calls_functions_mutually_recursive", { "total: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.callRecursion],
      ["codesys", "flw_case_real_label", { "total: GAP": 9, "group syntax: GAP": 1 }, ANALYSIS_NICHE_WHY.realLabel],
      ["twincat", "flw_case_real_label", { "total: GAP": 5, "group syntax: GAP": 1 }, ANALYSIS_NICHE_WHY.realLabel],
    ] as const
  ).flatMap(([vendor, fixture, counts, why]) =>
    Object.entries(counts).map(([measure, by]) => ({ baseline: `fixtures.${vendor}`, measure, by, fixture, task: "none: niche, accepted loss (analysis-conformance 3.7–3.9)", why })),
  ),
]
