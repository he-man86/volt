/**
 * THE `not-lowered` CEILING OF THE EVIDENCE RATCHET (`map.test.ts`) — the fixtures the vendor runs and lowering refuses,
 * with the history of every move. Kept beside the ratchet's other ceilings' reasons, out of the suite only for its length
 * (openspec lsp-same-standard 4.4: a suite is held to 600 lines).
 */

// 21 -> 25 by RECLASSIFICATION, not regression: fixtures that had never been ASKED turn out to be ones the vendor
// compiles and we refuse — `refuse_var_temp_struct`, two pointer derefs — which is exactly what this rating is for.
// 25 -> 27. `conversions/cross-family.ts` asked 76 conversions across the isolated families and found 35 the
// transpiler refused; 33 are implemented now (the whole date family plus TIME<->LTIME, one tick rule). The two
// left are `LTIME_TO_STRING` and `REAL_TO_STRING`, whose FORMAT is a fact one recording cannot generalize — one
// duration does not show whether an LTIME prints `us` and `ns` components, and one REAL does not show how many
// digits. They are refused honestly until a format sweep asks properly.
// 27 -> 49. `conversions/to-string-format.ts` recorded eleven shapes each of `REAL_TO_STRING` and
// `LREAL_TO_STRING`, and the two widths do not agree on the case of the exponent (`1.2345679E08` against
// `1.0e20`), on where plain notation stops, or on how many digits survive. Reproducing that from eleven points
// would be inventing the rest of it, and the prelude mirrors these line for line — a guess is a silent divergence
// between the backends, not a rough edge. 22 fixtures refuse on purpose, and the table in `lower/builtins.ts` is
// what a proper format sweep would extend. `LTIME_TO_STRING` from the same sweep IS implemented: its boundaries
// are all measured and it is a TIME's format with three more units.
// 49 -> 53. Six of those are address ALIASING — two names on one storage, which the vendor does and this has no
// byte-addressable area to do in. The whole model is measured at the refusal in `lower/storage.ts` (little-endian,
// addresses numbered in UNITS, bit 0 the least significant) and waiting for that area. `not-lowered` is the honest
// rating for it: the vendor runs them and we refuse.
// 53 -> 55: `atomic_xadd_pointer` and `atomic_cas_pointer` — the two probes the vendor ACCEPTS. They take the
// address of a local and pass it to an atomic, which `pointer-targets` refuses; the interesting half (what the
// operators demand of a non-pointer) is measured and implemented.
// 55 -> 75, and the whole rise is ONE formatter told apart from another. A format sweep of 70 more cells
// determined `LREAL_TO_STRING` completely (fifteen significant digits, fixed while the exponent is 0..13,
// lowercase `e`) — it is implemented in both backends and its 35 cells are `confirmed`. `REAL_TO_STRING` is a
// DIFFERENT formatter and the same sweep showed it is not derivable: two of its exponential cells print eight
// significant digits beside four that print seven at the same magnitudes, and four fractions round their
// seventh digit where rounding the value does not (1/3 is '0.3333334', 1/9 prints eight digits and stops).
// Its 35 cells refuse on purpose, with 70 measurements written down rather than a rule invented from them.
// 75 -> 80. `declarations/constant-folding.ts` asked 31 cells about what an initial value may hold; 26 of them
// now lower (a conversion, a shift, SIZEOF of a type, MIN/MAX/SEL/MUX/ABS/TRUNC/EXPT/SQRT, nested and
// parenthesised). The five here are the ones that are NOT constants and say so:
//   `cfold_user_function`, `cfold_user_function_reads_global`  a user FUNCTION runs, and sees an initialized global
//   `cfold_argument_declared_first`, `cfold_non_constant_argument`  initializers run in DECLARATION ORDER
//   `cfold_sizeof_var`  SIZEOF of a variable declared LATER — constant to the vendor, and our fold needs the slot
// The first four are one finding: a CODESYS initializer is an initialisation SEQUENCE, not a fold. Modelling
// that is the next increment, and these are its acceptance tests.
// 80 -> 88. `declarations/init-sequence.ts` asked 16 more cells about the initialisation SEQUENCE, and the eight
// that stay here are the ones an FB INSTANCE'S fields raise: an instance's initializers run per instance, which
// is the FB_Init machinery rather than the POU's init step, so `declareVars` only defers for the POU's own frame.
// Deferring in a layout would take the DEFAULT silently, which is the bug the refusal was added for.
// 88 -> 79. An FB INSTANCE'S field initializers run too now, as an implicit per-type routine `initStep` invokes
// at each instance — which is what a routine already is, a body that runs on an instance. Built while the
// LAYOUT is, before any body: a field may store an address (`p : POINTER TO X := ADR(y)`) and a body may only
// dereference that pointer once the store is known.
// 79 -> 87. `semantics/try-catch.ts` measured `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY` — the one construct that
// CHANGES the fault model: a divide by zero inside one is caught (code 258), the logarithm of a run-time zero
// too (338), and THE SCAN FINISHES where the same fault outside ends the application. Eight cells, complete and
// deliberately not lowered: the model is written at the refusal in `lower/statements.ts` so the implementation
// is not asked to guess, and the open design question is the Rust form (the emitter's faults are `panic!`).
// 87 -> 89. `declarations/reference-binding.ts` asked what a reference bound at its DECLARATION does, and two of
// its sixteen cells rebind afterwards — `refdecl_rebound_by_statement` (declaration bind, then `ref_ REF= other`)
// and `refdecl_rebound_in_method` (rebound from a METHOD, and the new target SURVIVES to the next scan: seen=20).
// Two targets is design §9 form 3, the tagged handle, which is not built — so these are refused honestly, and
// they are the first measured acceptance tests form 3 has.
// 89 -> 90. `sysop_position_value` reads `__POSITION`'s actual TEXT out of the simulator — the one question a
// build cannot answer — and the transpiler has no business lowering a CODESYS source-position intrinsic.
// 90 -> 98. `memory/pointer-parameters.ts` — eight fixtures RECORDED BEFORE the thing they measure is built,
// which is the order `memory-model.ts` beside them used and the order `fixtures/README.md` asks for. They are
// the acceptance tests for `pointer-model.md` §8 step 1: a `POINTER TO` input the callee only dereferences is a
// VAR_IN_OUT binding with a `^` on every use. The recordings say the erasure is sound —
//   `ptrparam_write`        the callee's `p^ := 77` changes the CALLER's variable, so it is a borrow, not a copy
//   `ptrparam_two_targets`  one input, two call sites, two ADR arguments, two answers (11 and 22) — which is
//                           precisely what form 1's ONE recorded target per pointer cannot represent
//   `ptrparam_kept`         a pointer input stored in a field still reads its target three scans later, so the
//                           handle form is real and this is the shape the borrow may NOT swallow
// This number is expected to come back DOWN by eight when step 1 lands, and further as it clears the 105 POUs
// `pointer-order` stops in the corpus. A ceiling that rises for measurement is not the same as one that rises
// for a gap, and the eight below are the first kind.
// 98 -> 94. Step 1 landed for a ROUTINE's pointer input — `ptrparam_read`, `_write`, `_two_targets` and
// `_method` lower and match CODESYS.
// 94 -> 95. `ptrparam_input_persists`, which answers the question that decides whether form 2 reaches an FB at
// all: it does NOT. An FB's VAR_INPUT is a FIELD, and the recording says it keeps its address — supplied on one
// call and OMITTED on the next, the body still reads 55 through it. So the address outlives the call by
// construction, which is §4's own definition of a HANDLE.
// 95 -> 92. FORM 3 READS. A pointer or reference naming several variables holds a TAG, and a read selects the
// arm it names (`IrSelect` — `IrDispatch` with a place where the call is). `refuse_pointer_two_targets` reads b
// after `p := ADR(a); p := ADR(b)`, and both `refdecl_rebound_*` follow a reference rebound after its
// declaration, one of them from a METHOD and across a scan. Writing through such a pointer is still refused,
// and says so: a place cannot express a select, so the write wants an `IrSwitch` over the arms.
// 92 -> 103. transpile-review-2026-09-29's recorded fixtures that lowering refuses today — tasks 11, 15, 22 (THIS),
// 23, 28, 34, 43 (three output conversions) and 44. Coverage the fixes are expected to take back.
// 103 -> 104. `tr_18_queryinterface_into_global` (task 18): a wrong answer turned into a refusal — the query's edge
// is foreign like the plain store's (`interface-instance-relative`); CODESYS's r1 = r2 = 1 wants form-3 lending.
// 104 -> 108. Task 11 lowers its fixture (-1); task 16 (`call-fb-inout`: a METHOD reaching the in-out of an FB copied
// whole) and task 17 (`pointer-type`: an ANY input's pValue dereferenced as another type, four) turn wrong answers
// into refusals (+5) — CODESYS's answers want the copied binding tag and a byte view.
// 108 -> 109, FOR MEASUREMENT. frontend-conformance 2.3a recorded `decl_var_generic_in_array` (an ARRAY OF a
// VAR_GENERIC FB with its value builds and runs on CODESYS); lowering refuses VAR_GENERIC as it does for
// `decl_var_generic` and `_read` — the transpiler's, not the front-end's.
// 109 -> 111, FOR MEASUREMENT. frontend-conformance 2.3.6 recorded two type expressions CODESYS builds and runs that
// lowering refuses: `decl_implicit_enum_in_array` (`a[1] := ia_b` — `place-not-local`, an implicit enum's value whose
// declaration is an ARRAY OF it is no constant to lowering, `constants.ts` reads only a declaration typed directly)
// and `decl_array_star_in_function_input` (a FUNCTION's `ARRAY[*]` VAR_INPUT indexed — `place-shape`). The
// transpiler's, not the front-end's.
// 111 stays, its members change (2.3b review): `decl_implicit_enum_in_array` LOWERS now (`constants.ts` reads an
// implicit enum through the ARRAY OF it; confirmed), and `decl_array_star_in_method_input` (a METHOD's `ARRAY[*]`
// VAR_INPUT, CODESYS builds and runs it) joins the function's. Both are `deferred.transpile`: lowering lends an open
// array only as a VAR_IN_OUT; niche: accepted loss (0 occurrences in the corpora — their 36 `ARRAY[*]` are VAR_IN_OUT).
// `decl_pointer_to_pointer_deref` was recorded refused by lowering and lowers too (`pointers.ts`: a pointer's storage
// is its target's), so it adds nothing here.
// 111 -> 113, FOR MEASUREMENT. frontend-conformance 2.4a recorded two units CODESYS builds and runs that lowering
// refuses, each the transpiler's and not the front-end's: `unit_fb_extends_qualified` (an FB extending a LIBRARY FB,
// `Standard.TON` — its base has no layout lowering reaches, `layout-base`; 0 qualified library bases in the corpora)
// and `unit_type_extends_on_union` (a UNION of INT and DINT — `layout-union`, its overlaid bytes unmeasured; the
// EXTENDS is only the warning's).
// 113 -> 130, FOR MEASUREMENT. frontend-conformance 2.5.6 (2026-10-02) recorded 17 expressions CODESYS builds and runs
// that lowering refuses, each the transpiler's and not the front-end's: nine inline assignments (`expr_inline_assign_*`
// — `assign_expr` is lowered nowhere, `cp_inline_assignment` is not either), six global-namespace reads, writes and
// calls (`expr_global_namespace_*`, the new `global_expr` node: "global_expr is not lowered yet"),
// `expr_this_as_pointer` (`p := THIS`) and `expr_pool_qualified_fb_type` (whose `__POOL.` type the parser refuses).
// 130 -> 132, FOR MEASUREMENT. The 2.5b review (2026-10-02) recorded two more CODESYS builds and runs that lowering
// refuses: `expr_inline_assign_for_start` (`assign_expr`, as above) and `expr_global_namespace_enum_bound` — an array
// bounded `E.Up...E.Left` is "not a sized array" (`aggregate-init`), and so it is with `..` and no dot: `constEval`
// folds no enum value yet (task 4.6.1; 60-odd enum-bounded arrays in the corpora wait on it).
// 132 -> 136, FOR MEASUREMENT. frontend-conformance 2.6 (2026-10-02) recorded four statements CODESYS builds and runs
// that lowering refuses, each the transpiler's and not the front-end's: `stmt_try_nested` and
// `stmt_try_catch_without_operand` (`__TRY` is lowered nowhere — `try_*` are not either), `stmt_bare_member` (a bare
// expression statement, `bx.v;`) and `stmt_label_at_end` (JMP and its label).
// 136 -> 137, FOR MEASUREMENT. The 2.6 review (2026-10-02): `stmt_function_own_name_bare` builds and runs (out = 12)
// and lowering refuses its bare-name statement, as `stmt_bare_member`'s (the transpiler's).
// 137 -> 139, FOR MEASUREMENT. frontend-conformance 2.7 (2026-10-02): `prag_if_hasconstanttype` (whether a constant is
// replaced is the project's "Replace constants" option, which the exec world does not state — refused by name, not
// guessed; P16 is area 4's) and `prag_unknown_attribute_on_union` (a UNION of INT and DINT — `layout-union`, the
// transpiler's, as `unit_type_extends_on_union`).
// 139 -> 146, FOR MEASUREMENT. frontend-conformance 2.10 (2026-10-02), each the transpiler's: `decl_pointer_to_pointer_deref_typed`
// (dereferences in a branch never taken — `pointer-order`, the pointer model wants an address stored before a `^`) and
// six `prag_to_string_*` — under `{attribute 'to_string'}` an enum's STRING conversions print the member's NAME
// (CODESYS 'On', "On"), which lowering printed as the number: a silent wrong answer, now refused by name
// (`lower/builtins.ts`; the name table is task 4.5.1's). `prag_to_string_absent` (no attribute, '1') is confirmed.
// 146 -> 151, FOR MEASUREMENT. frontend-conformance 3.1 (2026-10-02) recorded five scope fixtures CODESYS builds and runs
// that lowering refuses, each the transpiler's: `sym_global_namespace_dot_skips_local` (`expr-global_expr`, as the
// `expr_global_namespace_*`), `sym_method_output_param_bound` (a METHOD's VAR_OUTPUT bound `o => out`,
// `call-inout-alias`), `sym_library_gvl_qualified_by_list` and `_fully` (a library's global, `place-not-local`) and
// `sym_device_instance_bare` (`ADR(Device)`, a device instance has no storage the lowering knows, `place-not-local`).
// 151 -> 152, FOR MEASUREMENT. frontend-conformance 3.2 (2026-10-02): `inh_interface_method_output_param` builds and runs
// (out = 6) and lowering refuses an interface METHOD's VAR_OUTPUT bound `o => out`, as `sym_method_output_param_bound`
// (the transpiler's).
// 152 -> 161, FOR MEASUREMENT. frontend-conformance 3.4 (2026-10-02): 9 new library cells CODESYS builds and runs and the
// lowering refuses — library elements it has no body or place for (`ISLIBRELEASED`, `DATETIMEFROMWEEK`, a library's
// globals `Util.DAY_FLAGS.TUESDAY` / `Util.CONSTANTS.…`, `Util.Standard.LEN`, a library enum through a namespace or a
// namespace's dependency, bare `ERROR`): `lib_ns_type_qualified`, `_type_name_two_libraries`, `_library_member_own_type`,
// `_own_type_other_enum`, `_same_name_two_libraries`, `_transitive_qualification`, `_transitive_qualification_call`,
// `_library_gvl_member`, `_library_gvl_shared_list_name` (the transpiler's; src/transpile is not this change's to edit).
// 161 -> 162, FOR MEASUREMENT. frontend-conformance 3.5 (2026-10-02): `mem_private_method_of_same_type_instance` builds
// and runs (out 14) — a PRIVATE METHOD through a POINTER TO an instance of its own FB, `pOther := THIS` — and the lowering
// refuses it (the transpiler's).
// 162 -> 166, FOR MEASUREMENT. frontend-conformance 4.1/4.2 (2026-10-03): 4 new cells CODESYS builds and runs and the
// lowering refuses (the transpiler's; handed to transpile-restructure, task 5.3): `ty_dint_to_uxint` (`DINT_TO___UXINT`
// and the other platform-target conversions, "not a project FUNCTION"), `ty_version_type` (VERSION, "no declaration
// lowering can lay out"), `ty_array_of_pointer` ("a pointer stored somewhere this does not track") and
// `lt_literal_case_label_out_of_range` ("a CASE label outside the selector's type" — CODESYS converts 200 to SINT -56).
// 166 -> 286, FOR MEASUREMENT. frontend-conformance 4c (2026-10-03): 120 new cells CODESYS builds and runs and the
// lowering refuses (the transpiler's; handed to transpile-restructure, task 5.3): 111 explicit-pair conversions
// (`conversions/explicit-pairs.ts`, "conversion-type": a date or a duration to or from BOOL/REAL/LREAL, the cross-unit
// temporal ones, every X_TO_WSTRING and the STRING/WSTRING parses into a bit string or a date), the two
// `{attribute 'to_string'}` member-name cells (`cv_enum_to_string_*`, refused by name since 2.10) and 7 pointer cells
// (`cv_pointer_*`, `cv_reference_to_pointer`, `cv_xword_into_pointer`, `cb_compare_pointer_values`,
// `dt_pointer_arithmetic_values`: a pointer stored into an integer, compared, stepped). No wrong value: `diverges` stays 5.
// 286 -> 287, FOR MEASUREMENT. frontend-conformance 4d (2026-10-03): `ce_fold_untyped_in_context_values` (`NOT 0` into a
// WORD CONSTANT, "init-not-constant": the lowering asks the fold of the initializer alone, which has no context to give
// the literal a width) and `dt_union_member_sizes` (a UNION laid out and read through another member) — both the
// transpiler's, handed to transpile-restructure (task 5.3).
// 287 -> 289, FOR MEASUREMENT. frontend-conformance 4.7.4 (2026-10-03): `dt_this_into_pointer` (`p := THIS`, "THIS does
// not resolve" as a place) and `dt_this_deref_identity_values` (`SUPER^.v`, "deref is not a lowerable storage location
// yet") — the transpiler's, handed to transpile-restructure (task 5.3).
// 289 -> 300, FOR MEASUREMENT. lsp-sfc-step-names 1.1 (2026-10-03): 11 SFC cells CODESYS builds and runs; an SFC body has no
// ST to lower ("graphical-body", `lower/lower.ts`) — not a transpiler gap this change closes, and no wrong value.
// 300 -> 330, FOR MEASUREMENT. lsp-sfc-step-names 1 review (2026-10-03): 30 more SFC cells CODESYS builds and runs — the
// default step `Init`, a step beside a global, an enum member and a FUNCTION of its name, and the SFC flag variables
// declared with their type and another. Same reason: an SFC body has no ST to lower.
// 330 -> 334, FOR MEASUREMENT. lsp-sfc-step-names 2 review (2026-10-03): 4 more SFC cells CODESYS builds and runs — a step
// beside a struct, an FB instance and a pointer global of its name, and a WORD global's bit and partial access in an SFC
// action. Same reason: an SFC body has no ST to lower.
// 334 -> 337, FOR MEASUREMENT. lsp-sfc-step-names gate 2 (2026-10-03): 3 more SFC cells CODESYS builds and runs — a bit
// numbered by a GVL constant and by a local VAR CONSTANT, and a step written and read through THIS^ in its FB's method.
// Same reason: an SFC body has no ST to lower.
// 337 -> 338, FOR MEASUREMENT. lsp-sfc-step-names gate 3 (2026-10-03): S3 `sfc_step_qualified_self` — a step read
// SELF-qualified in its SFC program's own action (the field's shape), which CODESYS builds and runs. Same reason: an SFC
// body has no ST to lower.
// 338 -> 345, FOR MEASUREMENT. analysis-conformance 3.1 (2026-10-06): 8 cells both vendors build and CODESYS runs, a
// POINTER compared with a narrow or a signed integer (`cmpop_pointer_vs_{byte,uint,sint,lint,int_ordered}`) and stored
// into a LINT, an LREAL and a REAL (`ptrsc_into_{lint,real,real32}`) — asked for the analysis's pointer rules
// (`types/compat` `pointerComparison`, `pointerIntoElementary`); the transpiler lowers no pointer–integer mix.
// 345 -> 346, FOR MEASUREMENT. analysis-conformance 3.3 (2026-10-06): `dflt_function_input_from_variable` — a FUNCTION input
// defaulted with a global variable (CODESYS warns, builds and runs it), which the transpiler does not lower.
// 346 -> 349, FOR MEASUREMENT. analysis-conformance 3.1+3.3 gate review (2026-10-06): `ptrsc_into_xint` and
// `cmpop_pointer_vs_xint` (a POINTER stored into and compared with an __XINT — the pointer–integer mix the transpiler
// does not lower) and `dflt_method_input_from_variable` (a METHOD input defaulted with a global variable, as the
// FUNCTION's above).
// 349 -> 350, FOR MEASUREMENT. analysis-conformance 3.6 (2026-10-06): `oopa_inout_in_property` — a property's GET reading
// its FB's VAR_IN_OUT (CODESYS warns, builds and runs it); the transpiler gives an accessor no frame slot for the
// parameter ("io is a var, which has no frame slot yet", `place-not-local`).
// 350 -> 367, FOR MEASUREMENT. analysis-conformance 3.7–3.9 (2026-10-06): seventeen new rule cells CODESYS builds and
// runs, each a refusal the transpiler states — a JMP and its labels (3: "jmp/label is not lowered yet"), a bare
// expression statement (4: "expr_stmt is not lowered yet"), INI and __QUERYPOINTER (no project FUNCTION, 2), the address
// of a bit, of a BIT field, of a derived FB through a base's pointer (4), a method's output bound to the variable
// the call holds (3: `out := M(o => res)`), and two FUNCTIONs calling each other (1). No fixture moved.
// 367 -> 389, FOR MEASUREMENT. analysis-conformance 3.12 (2026-10-07): the 22 `initord_*` cells CODESYS builds and runs
// (`fixtures/cross-object/init-order.ts`) — every one initializes an FB instance's input with another PROGRAM's instance
// (or its own later instance), which lowering refuses as "an initial value that is not a compile-time constant". No
// fixture moved.
// 389 -> 390, FOR MEASUREMENT. transpile-restructure 3.10 (2026-10-08): `cursor_whole_store_capacity` — a STRING(10)
// stored through a POINTER TO STRING(20) into a STRING(5), which CODESYS builds and runs by writing past the variable
// into its neighbour; lowering refuses it by name (`cursor-overrun`; the local pointer form `pointer-type`). No fixture
// moved.
// 390 -> 394, FOR MEASUREMENT. transpile-restructure 4.1 (2026-10-09): four pointer-model questions CODESYS builds and
// runs, recorded before §3.3 decides the representation (`fixtures/memory/pointer-model.ts`) — pointer order compares,
// an ADR difference across two arrays, a byte pointer walking a padded STRUCT, a pointer through an LWORD and back; each
// refused by name (`pointer-value`, `adr-offset`, `pointer-type`). No fixture moved. Until 4b two of them also carried
// `pointer-order` — a knock-on of their own refused store, "before any address was stored" though one was; a use after
// a refused store now repeats that store's code, and an integer stored as a pointer is `pointer-value`.
export const NOT_LOWERED_CEILING = 394
