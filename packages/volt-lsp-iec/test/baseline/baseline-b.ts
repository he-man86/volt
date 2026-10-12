/**
 * the ceiling exceptions (`baseline.ts`) — part B.
 *
 * One slice of `baseline.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a test support
 * file is held to 400 lines).
 */
import { ANALYSIS_NICHE_WHY, CeilingException, DEAD_CODE_TASK, DEAD_CODE_WHY, LITERAL_TYPING } from "./baseline-shared.js"

export const CEILING_EXCEPTIONS_B: readonly CeilingException[] = [
  // (transpile-restructure 8.2 step 8e's string in-out rows left 2026-10-11, lsp-transpile-review-gaps 2.5 and 2.6.)
  // transpile-restructure 5.1 (2026-10-09): a STRUCT field's FB_Init argument naming a local of the declaring POU, which
  // both vendors refuse ("Identifier '…' not defined" and its conversion echo) and the LSP does not check — the fixture's
  // `deferred.lsp`. New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: `fixtures.${vendor}`,
    measure: "total: GAP",
    by: 2,
    fixture: "init_struct_field_fb_init_scope_local",
    task: "none: niche, accepted loss (0 STRUCT fields with FB_Init arguments in the corpora)",
    why: "a STRUCT field's FB_Init argument resolves in the struct's scope; the LSP checks no STRUCT field's FB_Init arguments",
  })),
  // transpile-restructure 6Ba+6Bb gate review (2026-10-10): an untyped literal past 32 bits beside a TIME, which both vendors
  // refuse ("Cannot convert type 'TIME' to type 'ULINT'" and its echo) and the LSP passes — the fixture's `deferred.lsp`.
  // New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: `fixtures.${vendor}`,
    measure: "total: GAP",
    by: 2,
    fixture: "tr_b5_time_times_wide_literal",
    task: "none: niche, accepted loss (0 integer literals past 32 bits beside a duration in the corpora)",
    why: "the vendors type an untyped literal past 32 bits beside a TIME as ULINT and refuse the TIME into it; the LSP's duration scaling reads only a declared integer's type",
  })),
  // …and its four type-dump findings: each vendor's two "Cannot convert" messages, which no store the front-end types explains
  {
    baseline: "type-dump",
    measure: "findings",
    by: 4,
    fixture: "tr_b5_time_times_wide_literal",
    task: "none: niche, accepted loss (0 integer literals past 32 bits beside a duration in the corpora)",
    why: "the vendors type an untyped literal past 32 bits beside a TIME as ULINT and refuse the TIME into it; the LSP's duration scaling reads only a declared integer's type",
  },
  // …and the front-end dumps over 5.1's fixtures. A VAR_GLOBAL list binds no scope in the dumps, so a GVL initializer is
  // NOSCOPE (its declaration in fold-dump, its literal in type-dump, a FUNCTION it calls in resolution-dump) — the
  // fixtures need a global that moves and a GVL initializer that stamps its order. The struct-scope gap above shows in
  // resolution-dump (the vendors' "not defined", recorded only) and type-dump (their conversion echo, no store typed).
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 2, "init_gvl_program_slot_order"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 1, "init_struct_field_fb_init_scope"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 1, "var_temp_dynamic_init_method"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 1, "var_temp_dynamic_init_function"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 1, "var_temp_dynamic_aggregate_init"],
        ["type-dump", `fixtures ${vendor}: literal NOSCOPE`, 1, "init_struct_field_fb_init_scope"],
        ["type-dump", `fixtures ${vendor}: literal NOSCOPE`, 1, "var_temp_dynamic_init_method"],
        ["type-dump", `fixtures ${vendor}: literal NOSCOPE`, 1, "var_temp_dynamic_init_function"],
        ["type-dump", `fixtures ${vendor}: literal NOSCOPE`, 1, "var_temp_dynamic_aggregate_init"],
        ["type-dump", "findings", 1, "init_struct_field_fb_init_scope_local"],
        ["resolution-dump", "findings", 2, "init_gvl_program_slot_order"],
        ["resolution-dump", `fixtures ${vendor}: bare name NOSCOPE`, 2, "init_gvl_program_slot_order"],
        ["type-dump", `fixtures ${vendor}: call NOSCOPE`, 2, "init_gvl_program_slot_order"],
        ["resolution-dump", "findings", 1, "init_struct_field_fb_init_scope_local"],
        ["resolution-dump", `messages ${vendor}: recorded only`, 1, "init_struct_field_fb_init_scope_local"],
        // gate 5a's review twins: the renamed slot-order probe (the same GVL initializers as its original) and the
        // global the struct field shadows (`sfsgFirst : INT := 11`)
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 2, "init_gvl_program_slot_order_renamed"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 1, "init_struct_field_fb_init_scope_shadow"],
        ["type-dump", `fixtures ${vendor}: literal NOSCOPE`, 1, "init_struct_field_fb_init_scope_shadow"],
        ["type-dump", `fixtures ${vendor}: call NOSCOPE`, 2, "init_gvl_program_slot_order_renamed"],
        ["resolution-dump", "findings", 2, "init_gvl_program_slot_order_renamed"],
        ["resolution-dump", `fixtures ${vendor}: bare name NOSCOPE`, 2, "init_gvl_program_slot_order_renamed"],
        // transpile-restructure 5.7's frame-order probes (step 5c): one stamping initializer in each of the two VAR_GLOBAL
        // lists of the fixture's ONE .gvl file (lines 3 and 7) — the same dump limit as above, not a second GVL unresolved
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 2, "init_frame_order_several"],
        ["type-dump", `fixtures ${vendor}: call NOSCOPE`, 2, "init_frame_order_several"],
        ["resolution-dump", "findings", 2, "init_frame_order_several"],
        ["resolution-dump", `fixtures ${vendor}: bare name NOSCOPE`, 2, "init_frame_order_several"],
        ["fold-dump", `fixtures ${vendor}: decl NOSCOPE`, 2, "init_frame_order_several_renamed"],
        ["type-dump", `fixtures ${vendor}: call NOSCOPE`, 2, "init_frame_order_several_renamed"],
        ["resolution-dump", "findings", 2, "init_frame_order_several_renamed"],
        ["resolution-dump", `fixtures ${vendor}: bare name NOSCOPE`, 2, "init_frame_order_several_renamed"],
      ] as const
    ).map(([baseline, measure, by, fixture]) => ({
      baseline,
      measure,
      by,
      fixture,
      task: "none: a GVL binds no scope in the front-end dumps; the struct-scope cell is niche, accepted loss (0 in the corpora)",
      why: "transpile-restructure 5.1's instance-initialization fixtures (2026-10-09), new ground measured, not a regression",
    })),
  ),
  // …and the front-end dumps over the same new cells (analysis-conformance 3.7–3.9, 2026-10-06), each a type the front-end
  // does not give where the vendor answers: INI has no result type, a STRUCT instance or THIS/SUPER out of place called or
  // dereferenced is untyped where the vendor refuses it, a bit access's address, a negated number as a FOR bound, a REAL
  // CASE label the parser takes (`flw_case_real_label`, niche), and two stores the bound census does not see (a refused
  // call's result, SQRT's operand). New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["call UNKNOWN", 1, "calls_ini_on_int", "INI has no result type in the front-end"],
        ["call UNKNOWN", 1, "calls_ini_on_fb_instance", "INI has no result type in the front-end"],
        ["call UNKNOWN", 1, "calls_struct_instance_called", "a STRUCT instance called — 'Cannot call object of type 'TYPE'' on the vendor"],
        ["deref UNKNOWN", 1, "flw_super_in_method_no_base", "SUPER^ in an FB extending nothing — refused by the vendor"],
        ["deref UNKNOWN", 1, "flw_this_in_function", "THIS^ in a FUNCTION — refused by the vendor"],
        ["ident_expr UNKNOWN", 1, "flw_this_in_function", "THIS in a FUNCTION — refused by the vendor"],
        ["member UNKNOWN", 1, "flw_this_in_function", "THIS^.a in a FUNCTION — refused by the vendor"],
        ["member UNKNOWN", 1, "calls_adr_on_bit_access", "a bit access `w.3` as ADR's operand"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 2, "flw_for_int_down_to_min", "the FOR bounds -32768 and -1, negated untyped numbers (LT14's)"],
      ] as const
    ).map(([kind, by, fixture, why]) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind}`,
      by,
      fixture,
      task: "the front-end's types of refused and operator-only expressions (analysis-conformance 3.7–3.9 measured)",
      why,
    })),
  ),
  { baseline: "type-dump", measure: "fixtures twincat: call UNKNOWN, on an untyped operand", by: 1, fixture: "calls_adr_on_bit_access", task: "ADR of a bit access (the front-end types no bit access, by design: `call-arguments` `isBitAccess`)", why: "ADR(w.3), which TwinCAT builds, measured 2026-10-06" },
  { baseline: "type-dump", measure: "fixtures codesys: call UNKNOWN, on an untyped operand", by: 1, fixture: "calls_adr_on_bit_access", task: "ADR of a bit access (the front-end types no bit access, by design: `call-arguments` `isBitAccess`)", why: "ADR(w.3), CODESYS's single-bit warning measured 2026-10-06" },
  // transpile-restructure 4.13 (d), 2026-10-09: the bit accesses through a REFERENCE the two new fixtures record (`rw.3`,
  // `rw.2`, `rw.0`, `rw.3` and `rw.3`, `rw.0`) — new ground, untyped as every bit access is
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    ([["reference_bit_access", 4], ["reference_bit_access_local", 2]] as const).map(([fixture, by]) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: member UNKNOWN`,
      by,
      fixture,
      task: "a bit access (the front-end types no bit access, by design: `call-arguments` `isBitAccess`)",
      why: "`rw.N` through a REFERENCE TO WORD, read and written — CODESYS runs both (record:exec 2026-10-09)",
    })),
  ),
  ...(["calls_constant_called", "calls_sqrt_of_bool", "calls_sqrt_of_string"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture,
    task: "the bound census reads assignments and initial values, not a refused call's result nor a FUNCTION's operand conversion",
    why: "a VAR CONSTANT called ('Unknown type: 'c()''), SQRT of a BOOL ('BOOL' to 'LREAL') and of a STRING ('STRING' to 'LREAL', gate 3.7+3.9) — both vendors, measured 2026-10-06 (analysis-conformance 3.8)",
  })),
  { baseline: "parse-census", measure: "findings", by: 2, fixture: "flw_case_real_label", task: "none: niche, accepted loss (analysis-conformance 3.9)", why: ANALYSIS_NICHE_WHY.realLabel },
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "parse-census",
    measure: `fixtures ${vendor}: refused with a syntax message, no LSP parse error`,
    by: 1,
    fixture: "flw_case_real_label",
    task: "none: niche, accepted loss (analysis-conformance 3.9)",
    why: ANALYSIS_NICHE_WHY.realLabel,
  })),
  // transpile-restructure 6.A.27 (step 6Af): a negative constant FOR step on every other unsigned counter
  // (`tr_a27_for_unsigned_counters_negative_step`: USINT, WORD, UDINT, DWORD, ULINT, LWORD) — LT14's classes 'into <counter>
  // — transpiler <counter>, checker SINT' that `tr_35_*` opened for BYTE and UINT, one literal more each
  { baseline: "literal-agreement", measure: "fixtures: literals the two disagree on", by: 6, fixture: "tr_a27_for_unsigned_counters_negative_step", task: LITERAL_TYPING, why: "a negative constant FOR step on six unsigned counters (6.A.27) — LT14's class 'into <counter>', one literal more each" },
  { baseline: "literal-agreement", measure: "fixtures: literals the two disagree on", by: 1, fixture: "flw_case_real_label", task: LITERAL_TYPING, why: "a REAL CASE label on an INT selector (analysis-conformance 3.9, niche) — 'into INT', the transpiler's LREAL" },
  { baseline: "literal-agreement", measure: "fixtures: literals the two disagree on", by: 1, fixture: "flw_case_label_beyond_byte", task: LITERAL_TYPING, why: "a CASE label 300 on a BYTE selector (analysis-conformance 3.9) — LT14's class 'into BYTE', one literal more" },
  { baseline: "fixtures.twincat", measure: "total: FP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
  { baseline: "fixtures.codesys", measure: "total: GAP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
  { baseline: "fixtures.codesys", measure: "group names: GAP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
  // (the routine output bindings `tr_43_routine_output_dint_to_int` / `_word_to_int` left 2026-10-11, lsp-transpile-review-gaps
  // 2.4: `call-arguments` judges a FUNCTION's output binding as the FB's, with the assignment's warning)
  // …and TwinCAT's warning on `ui > 0 - 1`, the UINT converting into the INT the constant expression is: the front-end
  // types an operation on untyped numbers by its context (LT14), so the pair has no INT to name — niche: accepted loss
  // (0 occurrences in the corpora: no comparison of an unsigned operand with a constant expression of untyped numbers)
  {
    baseline: "fixtures.twincat",
    measure: "total: GAP",
    by: 1,
    fixture: "tr_6_negative_expression_beside_unsigned",
    task: "none: niche: accepted loss (0 occurrences in the corpora)",
    why: "TwinCAT warns 'unsigned Type 'UINT' to signed Type 'INT'' on `ui > 0 - 1` (record:language 2026-10-09); CODESYS is silent",
  },
  // transpile-restructure 4.3 recorded the byte image's layout and reinterpretation (`memory/pointer-model.ts`): the FB
  // header's two fixtures take `SIZEOF` of an FB instance, which the front-end types UNKNOWN until SIZEOF has a result
  // type, and the DINT-as-REAL fixture initializes two DINTs with negated untyped numbers (`-2147483647 - 1`, `-8388609`)
  // — LT14's class, one operation on them among them. New ground measured, not a regression.
  // (review of step 4d: `fb_offsets_var_before_input`, the same FB header question with VAR declared first)
  // (6Af gate review: `tr_a31_sizeof_*_fb_var_input_constant`, SIZEOF of an FB with a VAR_INPUT CONSTANT, the same)
  ...(["fb_header_offsets_plain", "fb_header_offsets_implements", "fb_offsets_var_before_input", "tr_a31_sizeof_bound_fb_var_input_constant", "tr_a31_sizeof_fb_var_input_constant"] as const).flatMap((fixture) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: call UNKNOWN, SIZEOF or ADR (no result type yet, task 4.3.4)`,
      by: 1,
      fixture,
      task: "frontend-conformance 4.3.4 (SIZEOF's result type)",
      why: "SIZEOF of an FB instance (transpile-restructure 4.3, the FB header's offsets) — no result type yet",
    })),
  ),
  ...(["codesys", "twincat"] as const).flatMap((vendor) => [
    {
      baseline: "type-dump",
      measure: `fixtures ${vendor}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`,
      by: 2,
      fixture: "reinterpret_dint_as_real_edges",
      task: LITERAL_TYPING,
      why: "the DINT edge patterns `-2147483647 - 1` and `-8388609` (transpile-restructure 4.3) — negated untyped numbers, LT14's class",
    },
    {
      baseline: "type-dump",
      measure: `fixtures ${vendor}: binary UNKNOWN`,
      by: 1,
      fixture: "reinterpret_dint_as_real_edges",
      task: LITERAL_TYPING,
      why: "`-2147483647 - 1`, an operation on two untyped numbers (transpile-restructure 4.3) — typed by its context, LT14's",
    },
  ]),
  // transpile-restructure 6.2's gate (2026-10-09): rule LT12 asked of every negative literal class, parenthesised, and as a
  // constant expression (`tr_6_negative_*_beside_unsigned`, both vendors) — negated untyped numbers, a parenthesised one and
  // `0 - 1`, each typed by its context (LT14's class). New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 2, "tr_6_negative_int_beside_unsigned", "-200 beside a USINT and a UINT"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_6_negative_dint_beside_unsigned", "-40000 beside a UINT"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_6_negative_lint_beside_unsigned", "-3000000000 beside a UINT"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_6_negative_paren_beside_unsigned", "(-1) beside a UINT"],
        ["paren UNKNOWN", 1, "tr_6_negative_paren_beside_unsigned", "(-1) beside a UINT, the parenthesised literal"],
        ["binary UNKNOWN", 1, "tr_6_negative_expression_beside_unsigned", "`0 - 1` beside a UINT, an operation on two untyped numbers"],
      ] as const
    ).map(([kind, by, fixture, why]) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind}`,
      by,
      fixture,
      task: LITERAL_TYPING,
      why,
    })),
  ),
  // transpile-restructure 6.A (2026-10-10): the Appendix A/B recordings write untyped numbers where their context types them
  // — the MIN MOD -1 dividends and `0 - 1` divisors (`arithedge_*_mod_min_by_minus_one`), SHL / SHR of an untyped literal
  // (`tr_a14_*`, the call typed by its destination: the finding the fixtures record), negated and parenthesised real
  // literals handed to SIN / SQRT / COS / EXP (`tr_a23_*`), a subrange's negative bounds (`tr_a25_subrange_defaults`),
  // `5.5 MOD 2.0` (`tr_a20_*`) — each typed by its context (LT14's class) — and one `s[i]` through a REFERENCE TO STRING
  // (`tr_a18_char_store_through_reference`, the string index the hand-off types). New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ...(["sint", "int", "dint", "lint"] as const).flatMap((t): (readonly [string, number, string, string])[] => [
          ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, `arithedge_${t}_mod_min_by_minus_one`, "the minimum, written negated"],
          ["binary UNKNOWN", 1, `arithedge_${t}_mod_min_by_minus_one`, "`0 - 1`, an operation on two untyped numbers"],
        ]),
        ["call UNKNOWN", 7, "tr_a14_shift_untyped_literal_wide", "SHL / SHR of an untyped literal by a constant count"],
        ["call UNKNOWN", 6, "tr_a14_shift_untyped_literal_variable_count", "SHL / SHR of an untyped literal, by a variable count and nested"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_a23_negated_real_literal_sin_into_int", "SIN(-1.5)'s argument"],
        ["paren UNKNOWN", 1, "tr_a23_parenthesised_real_literal_sqrt_into_int", "SQRT((2.0))'s argument"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 2, "tr_a23_signed_real_literal_in_math", "SIN(-1.5)'s and EXP((-1.0))'s negated literals"],
        ["paren UNKNOWN", 3, "tr_a23_signed_real_literal_in_math", "(2.0), (0.5) and (-1.0) as arguments"],
        ["unary UNKNOWN", 1, "tr_a23_signed_real_literal_in_math", "COS(-(0.5))'s argument, a negated parenthesis"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 3, "tr_a25_subrange_defaults", "the subranges' negative bounds -5, -10, -2"],
        ["binary UNKNOWN", 1, "tr_a20_real_mod_in_initializer", "`5.5 MOD 2.0`, refused on both vendors"],
        // step 6Af: a FOR's negative constant step on an unsigned counter (`tr_a27_*`, the step typed by the counter), and
        // ROL / ROR of an untyped literal (`tr_a30_*`, the call typed by its destination — the finding the fixtures record)
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 6, "tr_a27_for_unsigned_counters_negative_step", "the six steps BY -1, -3, -45, -2, -5, -1"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_a27_for_byte_named_constant_step", "STEPB : SINT := -2"],
        ["unary UNKNOWN", 1, "tr_a27_for_uint_negated_parenthesised_step", "BY -(3), a negated parenthesis"],
        ["paren UNKNOWN", 1, "tr_a27_for_uint_negated_parenthesised_step", "(3) under BY -(3)"],
        ["call UNKNOWN", 10, "tr_a30_rotate_untyped_literal", "ROL / ROR of an untyped literal by a literal count"],
        ["call UNKNOWN", 8, "tr_a30_rotate_untyped_literal_variable_count", "ROL / ROR of an untyped literal by a variable count"],
        ["call UNKNOWN", 6, "tr_a30_rotate_untyped_literal_initializer", "ROL / ROR of an untyped literal as initializers"],
        ["call UNKNOWN", 2, "tr_a30_rotate_untyped_literal_in_expression", "ROL / ROR of an untyped literal beside a WORD / DWORD"],
        ["call UNKNOWN", 2, "tr_a30_rotate_untyped_literal_into_int", "ROL / ROR of an untyped literal into an INT / DINT"],
        // 6Af gate review: the destination's width or the other operand's, told apart (`_operand_width`)
        ["call UNKNOWN", 3, "tr_a30_rotate_untyped_literal_operand_width", "ROR(1, 1) beside a WORD / DWORD, into a DWORD / LWORD"],
        ["binary UNKNOWN", 3, "tr_a30_rotate_untyped_literal_operand_width", "the OR over ROR(1, 1) and a WORD / DWORD"],
        // step 6Bb: a platform conversion's negated argument in an initializer (`tr_b5_*`, DINT_TO___UXINT(-1))
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_b5_platform_conversion_initializers", "DINT_TO___UXINT(-1)'s argument"],
        // 6Ba+6Bb gate review: negative initial values (`tr_b5_time_by_negative_signed`, `tr_b1_real_to_bit_*`) and a TIME
        // scaled by an untyped literal past DINT (`tr_b5_time_times_*_literal`: the LSP's duration scaling reads a declared
        // integer's type, not a literal's — the wide one is the fixture's `deferred.lsp`, niche: accepted loss)
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 3, "tr_b5_time_by_negative_signed", "the initial values -1, -2, -1"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_b1_real_to_bit_into_bool", "m : REAL := -1.5"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "tr_b1_real_to_bit_field", "m : REAL := -1.5"],
        ["binary UNKNOWN", 1, "tr_b5_time_times_wide_literal", "`t * 5000000000`, refused on both vendors"],
        ["binary UNKNOWN", 1, "tr_b5_time_times_udint_literal", "`t * 3000000000`"],
        // step 7.8d: a UNION member stored a negative value (`type_dut_union_*`, transpile-restructure 7.8.4)
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "type_dut_union_int_dint_store_dint", "u.dv := -2"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "type_dut_union_int_dint_store_int", "u.iv := -2"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 1, "type_dut_union_lreal_bytes_store_lreal", "u.lv := -0.1"],
      ] as const
    ).map(([kind, by, fixture, why]) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind}`,
      by,
      fixture,
      task: LITERAL_TYPING,
      why,
    })),
  ),
  // (`tr_a18_char_store_through_reference`'s `rs[1]` and `string_inout_wider_reads`' `SEL(g, 'x', io)` left 2026-10-11,
  // lsp-transpile-review-gaps 2.3 and 2.7: a STRING's unit and a selection over STRINGs are typed, `infer/expr`.)
  // FOR MEASUREMENT (transpile-refusal-classification 2.2): the `rk_*` asks are each one question for a refusal code, and the
  // invalid ST among them reaches the front-end's own gaps — each niche: accepted loss (0 occurrences in the corpora, every
  // corpus project builds), each the fixture's `deferred.lsp` or `MEASURED_SILENT` in `transpile-replay.test.ts`
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["binary UNKNOWN", "rk_pointer_stepped_by_struct", "a pointer plus a STRUCT, which CODESYS refuses (\"Cannot convert type 'DUT…' to type 'LWORD'\")"],
        ["call UNKNOWN", "rk_builtin_mixed_types", "MAX of a BOOL and a TIME, which CODESYS refuses (\"Cannot convert type 'BOOL' to type 'TIME'\")"],
        ["index UNKNOWN", "rk_string_indexed_two_dims", "a STRING indexed twice, which CODESYS refuses (\"… requires exactly 1 Index\")"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", "rk_partial_access_signed", "`i : INT := -2`, a negated untyped number as LITERAL_TYPING leaves them"],
        ["parameter NO-CALLEE", "rk_builtin_named_args", "LIMIT given NAMED parameters (`MN :=`), which CODESYS refuses: the names bind to no callee's parameter"],
        ["recorded only", "rk_builtin_named_args", "LIMIT given NAMED parameters: \"Identifier 'MN' not defined\", one per name, which the LSP does not say"],
      ] as const
    ).map(([measure, fixture, why]) => ({
      baseline: measure.startsWith("parameter") || measure === "recorded only" ? "resolution-dump" : "type-dump",
      measure: measure === "recorded only" ? `messages ${vendor}: recorded only` : `fixtures ${vendor}: ${measure}`,
      by: measure.startsWith("parameter") || measure === "recorded only" ? 3 : 1,
      fixture,
      task: "openspec transpile-refusal-classification 2.2 — a front-end gap the asks measured, niche",
      why,
    })),
  ),
  ...(
    [
      ["type-dump", 2, "rk_pointer_stepped_by_struct", "the build's \"Cannot convert type 'DUT…' to type 'LWORD'\" types no store the front-end types"],
      ["type-dump", 2, "rk_open_array_assigned_whole", "the build's \"Cannot convert type 'POINTER TO INT' to type 'ARRAY [1..3] OF INT'\" types no store the front-end types"],
      ["type-dump", 2, "rk_builtin_mixed_types", "the build's \"Cannot convert type 'BOOL' to type 'TIME'\" types no store the front-end types"],
      ["resolution-dump", 12, "rk_builtin_named_args", "LIMIT's named parameters: three NO-CALLEE sites and three recorded-only messages, per vendor"],
      ["fold-dump", 1, "rk_fb_init_with_inout", "`src` runs at 4 where its initializer folds to 3: the FB_Init it is bound to as a VAR_IN_OUT adds 1 before the first cycle"],
      ["fold-dump", 1, "rk_union_member_initial_value", "a UNION member's initial value, 16#0102, reads 16#0100 (256) after the init: how CODESYS initializes an overlaid member is the open question (`layout-union`)"],
    ] as const
  ).map(([baseline, by, fixture, why]) => ({
    baseline,
    measure: "findings",
    by,
    fixture,
    task: "openspec transpile-refusal-classification 2.2 — a front-end gap the asks measured, niche",
    why,
  })),
  // …and the diagnostic census (`test/analysis`) counts the same asks' GAPs: CODESYS or TwinCAT refuses (or, for
  // `rk_program_calls_itself`, warns "Call recursion" about) ST the LSP says nothing of — the same niche, accepted loss
  // (0 occurrences in the corpora; transpile-refusal-classification gate 2). TwinCAT alone refuses
  // `rk_function_empty_argument`, `rk_fb_init_with_inout` and `rk_super_base_library` (its library is `Tc2_Standard`).
  ...(
    [
      ["fixtures.codesys", "rk_builtin_mixed_types", "total: GAP", 2],
      ["fixtures.codesys", "rk_builtin_mixed_types", "group types: GAP", 1],
      ["fixtures.codesys", "rk_builtin_named_args", "total: GAP", 10],
      ["fixtures.codesys", "rk_function_output_bound_with_assign", "total: GAP", 1],
      ["fixtures.codesys", "rk_function_output_bound_with_assign", "group calls: GAP", 1],
      ["fixtures.codesys", "rk_init_slot_method_with_input", "total: GAP", 1],
      ["fixtures.codesys", "rk_init_slot_method_with_input", "total: unowned GAP", 1],
      ["fixtures.codesys", "rk_inout_other_struct", "total: GAP", 1],
      ["fixtures.codesys", "rk_inout_other_struct", "group calls: GAP", 1],
      ["fixtures.codesys", "rk_interface_given_fb_not_implementing", "total: GAP", 1],
      ["fixtures.codesys", "rk_interface_given_integer", "total: GAP", 1],
      ["fixtures.codesys", "rk_open_array_assigned_whole", "total: GAP", 1],
      ["fixtures.codesys", "rk_partial_access_out_of_range", "total: GAP", 1],
      ["fixtures.codesys", "rk_partial_access_out_of_range", "total: unowned GAP", 1],
      ["fixtures.codesys", "rk_partial_access_signed", "total: GAP", 1],
      ["fixtures.codesys", "rk_partial_access_signed", "total: unowned GAP", 1],
      ["fixtures.codesys", "rk_pointer_stepped_by_struct", "total: GAP", 1],
      ["fixtures.codesys", "rk_program_calls_itself", "total: GAP", 1],
      ["fixtures.codesys", "rk_program_calls_itself", "total: unowned GAP", 1],
      ["fixtures.codesys", "rk_program_instance_property_written", "total: GAP", 1],
      ["fixtures.codesys", "rk_ref_assign_in_chain", "total: GAP", 1],
      ["fixtures.codesys", "rk_ref_assign_in_chain", "group types: GAP", 1],
      ["fixtures.codesys", "rk_string_indexed_two_dims", "total: GAP", 1],
      ["fixtures.codesys", "rk_string_indexed_two_dims", "group types: GAP", 1],
      ["fixtures.twincat", "rk_builtin_mixed_types", "total: GAP", 2],
      ["fixtures.twincat", "rk_builtin_mixed_types", "group types: GAP", 1],
      ["fixtures.twincat", "rk_builtin_named_args", "total: GAP", 10],
      ["fixtures.twincat", "rk_fb_init_with_inout", "total: GAP", 1],
      ["fixtures.twincat", "rk_fb_init_with_inout", "group oop: GAP", 1],
      ["fixtures.twincat", "rk_function_empty_argument", "total: GAP", 1],
      ["fixtures.twincat", "rk_function_empty_argument", "group calls: GAP", 1],
      ["fixtures.twincat", "rk_function_output_bound_with_assign", "total: GAP", 1],
      ["fixtures.twincat", "rk_function_output_bound_with_assign", "group calls: GAP", 1],
      ["fixtures.twincat", "rk_init_slot_method_with_input", "total: GAP", 1],
      ["fixtures.twincat", "rk_init_slot_method_with_input", "total: unowned GAP", 1],
      ["fixtures.twincat", "rk_inout_other_struct", "total: GAP", 1],
      ["fixtures.twincat", "rk_inout_other_struct", "group calls: GAP", 1],
      ["fixtures.twincat", "rk_interface_given_fb_not_implementing", "total: GAP", 1],
      ["fixtures.twincat", "rk_interface_given_integer", "total: GAP", 1],
      ["fixtures.twincat", "rk_open_array_assigned_whole", "total: GAP", 1],
      ["fixtures.twincat", "rk_pointer_stepped_by_struct", "total: GAP", 1],
      ["fixtures.twincat", "rk_program_instance_property_written", "total: GAP", 1],
      ["fixtures.twincat", "rk_ref_assign_in_chain", "total: GAP", 1],
      ["fixtures.twincat", "rk_ref_assign_in_chain", "group types: GAP", 1],
      ["fixtures.twincat", "rk_string_indexed_two_dims", "total: GAP", 1],
      ["fixtures.twincat", "rk_string_indexed_two_dims", "group types: GAP", 1],
      ["fixtures.twincat", "rk_super_base_library", "total: GAP", 3],
      ["fixtures.twincat", "rk_super_base_library", "group flow: GAP", 1],
    ] as const
  ).map(([baseline, fixture, measure, by]) => ({
    baseline,
    measure,
    by,
    fixture,
    task: "openspec transpile-refusal-classification 2.2 — a front-end gap the asks measured, niche",
    why: "an `rk_*` ask's vendor-refused ST, which the LSP does not refuse — niche: accepted loss (0 occurrences in the corpora)",
  })),
]
