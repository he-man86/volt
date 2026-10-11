# Tasks: lsp-transpile-review-gaps

Paths are relative to `packages/volt-lsp-iec/`. Each task is one LSP-only finding of the transpiler work, filed by
`transpile-restructure` (its design.md §7.1 and every task there whose acceptance says "Filed"). A task closes when the LSP gives
the recorded answer and the fixture's mark is gone (the expected-failure guard enforces both). Recordings are the oracle: a task
never changes a recording or a fixture's expectation to match the LSP.

## 1. Initial list (transpile-restructure design.md §7.1, created by its task 0.7 on 2026-10-07)

- [x] 1.1 RC 13 — the LSP accepts a FOR limit wider than the counter.
  - What: CODESYS refuses `FOR i : INT := … TO <DINT>` with "Cannot convert type 'DINT' to type 'INT'" (a DINT variable, a DINT
    expression, `UPPER_BOUND`); a UINT counter's `n - 1` limit it compiles (`for_limit_wider_than_counter_uint_expr`, confirmed).
    The LSP says nothing.
  - Fixtures: `for_limit_wider_than_counter_dint_var`, `for_limit_wider_than_counter_dint_expr`,
    `for_limit_wider_than_counter_upper_bound` (`test/conformance/fixtures/semantics/execution.ts`; `lsp-gap`, held by
    `transpile-replay.test.ts` `MEASURED_SILENT`, recorded 2026-09-29 for transpile-review task 13).
  - Accept: the three rate `refused` (the LSP reports the recorded message); removed from `MEASURED_SILENT`;
    `for_limit_wider_than_counter_uint_expr` stays confirmed with no LSP error.
  - Transpiler half: transpile-restructure 2.6.
  - Done 2026-10-11: `analysis/checks/flow/statement-rules` `for-bound-type` judges a FOR limit and step by type (`classifyConversion` `incompatible`, the transpiler's rule); the three rate `refused`, out of `MEASURED_SILENT`; `_uint_expr` stays confirmed. Src test beside the check.
- [x] 1.2 RC 35 — the LSP accepts a FOR step the counter's type cannot hold.
  - What: CODESYS refuses a runtime INT step on a BYTE counter ("Cannot convert type 'INT' to type 'BYTE'") and a constant step 300
    on a SINT counter ("… to type 'SINT'"). The LSP says nothing.
  - Fixtures: `tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` (`test/conformance/fixtures/semantics/execution.ts`;
    `lsp-gap`, `MEASURED_SILENT`, recorded 2026-09-29).
  - Accept: both rate `refused`; removed from `MEASURED_SILENT`; the confirmed FOR-step fixtures (`tr_35_for_byte_step_255`,
    `callshape_for_runtime_step`) stay free of LSP errors.
  - Transpiler half: transpile-restructure 2.4.
  - Done 2026-10-11: the same check asks a folded step by VALUE (it fits the counter, or is a negative one an unsigned counter's signed twin holds), refused as its literal type; both rate `refused`, out of `MEASURED_SILENT`; `tr_35_for_byte_step_255`, `callshape_for_runtime_step` free of LSP errors.
- [x] 1.3 RC 37 — CASE labels outside the selector type and inverted ranges.
  - Fixtures: `tr_37_case_label_wraps_300`, `tr_37_case_label_wraps_minus_212`, `tr_37_case_range_inverted`,
    `tr_37_case_range_beyond_type`.
  - Done before this change existed: RC 37 was closed in the LSP and lowering by `transpile-review-2026-09-29` (194319e648); all four
    rate `refused` in `map.generated.ts` (CODESYS refuses, the LSP reports an error), none is in `MEASURED_SILENT`. Listed because
    transpile-restructure design.md §7.1 names it; nothing is owed here. Transpiler half: transpile-restructure 6.12 (verify).
- [x] 1.4 RC 20 — the LSP false positive on a FUNCTION's VAR_OUTPUT binding.
  - What: CODESYS builds and RUNS `tr_20_output_index_moved_by_callee`; the LSP reports `'o' is no output of 'F_CS_OUT20'` and a
    wrong input count for the FUNCTION's `o => arr2[gCsK20]` output binding. The call check does not read a FUNCTION's VAR_OUTPUT.
  - Fixtures: `tr_20_output_index_moved_by_callee` (`test/conformance/fixtures/calls/call-shapes.ts`; confirmed, held by
    `test/conformance/support/divergences.ts` `KNOWN_DIVERGENCES.codesys`, recorded 2026-09-29).
  - Accept: the LSP reports nothing on the fixture; it leaves `KNOWN_DIVERGENCES.codesys`; a src test beside the call check.
  - Transpiler half: transpile-restructure 4.11.
  - Done 2026-10-11: no LSP defect — a REPLAY collision. `callshape_output_index_before_call` declares a FUNCTION `F_CS_out20` with another signature, and the replay binds every fixture into one project, so the call resolved to that one. The fixture's FUNCTION is renamed `F_CS_outMoved20` and re-recorded (record:exec CODESYS, values unchanged; record:language both vendors, builds clean); out of `KNOWN_DIVERGENCES.codesys`; a src test in `call-arguments.test.ts` holds the FUNCTION/METHOD output binding.
- [x] 1.5 RC 38 — the LSP half of implicit STRING↔WSTRING and non-string→STRING refusals, if transpile-restructure 6.13 finds one.
  - What: on 2026-10-07 the LSP already refuses the listed fixtures (`string_wstring_mixing`, every `uop_*`,
    `standard_len_wstring_rejected` rate `refused`), so there is no known LSP half. transpile-restructure 6.13 (stores, chain links,
    stores through a REFERENCE, arguments, compares) appends here any shape it records that the LSP accepts; if it finds none, 6.13
    ticks this task with that result.
  - Fixtures: `string_wstring_mixing`, `uop_*`, and whatever 6.13 records.
  - Accept: every shape 6.13 files rates `refused`, or this task is ticked by 6.13 with "no LSP half found".
  - Ticked by transpile-restructure 6.13 (2026-10-09): no LSP half found. The one shape 6.13 recorded, a store THROUGH A
    REFERENCE (`tr_38_ref_store_string_into_int`, `_int_into_string`, `_string_into_wstring`: "Cannot convert type 'STRING' to
    type 'REFERENCE TO INT'"), rates `refused` — the LSP already objects.
    Checked against the BUILD recordings at transpile-restructure's 6a-6d gate (record:language 2026-10-09, both vendors): the
    three are "Cannot convert type 'STRING' to type 'REFERENCE TO INT'" (and the INT/STRING, STRING/WSTRING twins) on CODESYS
    and TwinCAT alike, and the LSP's diagnostics agree with both recordings.

## 2. Filed later

Appended by transpile-restructure steps, one line each, in the commit that finds the gap.

- [x] 2.1 RC 13 / RC 35, more shapes (transpile-restructure 2.6, recorded 2026-10-08) — the LSP accepts a typed FOR bound that does
  not convert into the counter: a named DINT CONSTANT limit and a `DINT#5` limit on an INT counter, and a DINT step that is not a
  bare variable (`BY (k - 1)`, `BY UPPER_BOUND(a, 1)`). CODESYS: "Cannot convert type 'DINT' to type 'INT'". Fixtures
  `for_limit_wider_than_counter_dint_constant`, `_typed_literal`, `for_step_wider_than_counter_dint_paren`, `_upper_bound`
  (`lsp-gap`, `MEASURED_SILENT`); and a typed literal step whose value fits, `BY INT#-1` on a BYTE ("Cannot convert type
  'INT' to type 'BYTE'", `for_step_typed_literal_on_narrower_counter`, gate 2c); a same-width sign change (`for_limit_sign_change_int_on_uint`, `_uint_on_int`) compiles and
  must stay free of LSP errors. Close with 1.1/1.2: the bound judged by its type (`classifyConversion` `incompatible`).
  - Done 2026-10-11 with 1.1/1.2 (`for-bound-type`): all seven rate `refused`, out of `MEASURED_SILENT`; the sign-change pair stays free of LSP errors.
- [x] 2.2 `FOR … BY k - 1` (unparenthesised binary step) is a CODESYS PARSE error, "'DO' expected instead of '-'" (transpile-
  restructure 2.6, recorded 2026-10-08); the parser accepts it. Fixture `for_step_wider_than_counter_dint_expr` (`lsp-gap`,
  `MEASURED_SILENT`). Niche: accepted loss (0 occurrences in the corpora) — which binary operators a BY operand admits is
  unrecorded.
  - Done 2026-10-11, niche: accepted loss (0 occurrences in the corpora): the fixture carries `rejects` (the recorded parse error) and `lspDeferred` — the LSP now refuses `BY k - 1` by type (`for-bound-type`), not as the vendor's parse error; out of `MEASURED_SILENT`.
- [x] 2.3 `s[i]` on a STRING / WSTRING types UNKNOWN in the front-end (transpile-restructure 3.1, measured 2026-10-08): the
  character access is a BYTE (a WSTRING's a WORD) — `lib_prim_char_past_length` records `BYTE#…`, `string_non_ascii_bytes`
  `text[0]` = BYTE#99. 26 uses in the fixtures before 3.1, +171 in the string-model fixtures of 3.1, gate 3a, 3.6, gate 3c, 3.8-3.11 and gate 3d (per vendor), 5 in the corpora
  (all pro2193). Each 3.1 fixture's count is a named ceiling exception (`test/frontend/baseline.ts` `STRING_INDEX_ROWS`),
  removed when the read is typed.
  - Done 2026-10-11: `types/infer/expr` types `s[i]` on a STRING as BYTE, on a WSTRING as WORD (through a REFERENCE too); `STRING_INDEX_ROWS` and `tr_a18_char_store_through_reference`'s exception removed, baselines re-pinned (fixtures index UNKNOWN 26/25 -> 1/0, library 47 -> 0, corpus 92 -> 87).
- [x] 2.4 RC 43, the routine path (transpile-restructure 6.17, recorded 2026-10-09) — a FUNCTION's DINT VAR_OUTPUT bound `o => t`
  into an INT is "Cannot convert type 'DINT' to type 'INT'" on CODESYS, and the LSP accepts it; it refuses the FB path's twin
  (`tr_43_output_dint_to_int`, `refused`). Fixture `tr_43_routine_output_dint_to_int` (`lsp-gap`, `MEASURED_SILENT`; TwinCAT records
  the same error, record:language 2026-10-09). Its converting twin, a WORD output into an INT (`tr_43_routine_output_word_to_int`), earns
  "Implicit conversion from unsigned Type 'WORD' to signed Type 'INT'" on both vendors, which the LSP does not say either; both
  are named GAP exceptions in `test/frontend/baseline.ts` until this task lands. The
  output binding of a FUNCTION / METHOD call judged by the assignment relation (`isAssignable`), as the FB call's is.
  - Done 2026-10-11: `call-arguments` reads a FUNCTION's / METHOD's VAR_OUTPUT from its own sections and judges the binding as the FB's, plus the assignment's conversion warning on that path (measured there only); both `tr_43_routine_output_*` exceptions and the `MEASURED_SILENT` entry removed.
- [x] 2.5 A STRING / WSTRING bound to a VAR_IN_OUT that declares MORE units (transpile-restructure 8.2 step 8e, recorded 2026-10-11 on
  both vendors) — a STRING(4) variable to a `VAR_IN_OUT io : STRING(10)`, a STRING(10) in-out passed on to a STRING(12) one, a
  WSTRING(4) to a WSTRING(10): CODESYS "String variable 'v' too short for the VAR_IN_OUT parameter 'io' of 'F_InoutNarrowerCopy'"
  (TwinCAT names the two the other way round: "String variable 'io' too short for the VAR_IN_OUT parameter 'v' of …", with a
  line); the LSP accepts it. A VAR_IN_OUT CONSTANT bound narrower builds (`xo4_inout_constant_chain`), and wider builds
  (`string_inout_wider_*`). Fixtures `string_inout_narrower`, `wstring_inout_narrower` (`lsp-gap`, `MEASURED_SILENT`); the
  transpiler refuses them (`call-inout-short`). The call-argument check judging a string in-out's capacity, CONSTANT excepted.
  - Done 2026-10-11: `call-arguments` `in-out-string-too-short` — a non-CONSTANT STRING / WSTRING in-out bound to a variable of fewer units, worded per vendor (`stringTooShortForInOut`); both rate `refused`, out of `MEASURED_SILENT` and the baseline exceptions.
- [x] 2.6 A string literal too long for a VAR_IN_OUT it is stored into (transpile-restructure 8.2 step 8e, recorded 2026-10-11 on both
  vendors): `io := 'XYZXYZXYZXYZXYZ'` into a `VAR_IN_OUT io : STRING(10)` — and its WSTRING twin — builds with NO warning, where the
  LSP's `string-constant-too-long` (C0198) warns as for any STRING(10) target. Fixtures `string_inout_wider_stores`,
  `wstring_inout_wider` (`support/divergences.ts` `STRING_CONSTANT_INTO_AN_INOUT`, both vendors). Measure first which targets the
  vendors leave unwarned — an in-out only, or every target reached through a reference (`REFERENCE TO`, `p^`) — then exempt them.
  - Done 2026-10-11. Measured (record:language both vendors, record:exec CODESYS): through a REFERENCE TO STRING(10) unwarned (`string_literal_through_reference_too_long`), into an FB's VAR_IN_OUT unwarned (`string_literal_into_fb_inout_too_long`), through a dereferenced POINTER TO STRING(10) warned (`string_literal_through_pointer_too_long`). `string-constant` exempts a VAR_IN_OUT target (a REFERENCE was already silent); `STRING_CONSTANT_INTO_AN_INOUT` and its baseline rows removed.
- [x] 2.7 `SEL(g, 'x', io)` over a STRING literal and a STRING(10) (transpile-restructure 8.2 step 8e, recorded 2026-10-11 on both
  vendors: builds; CODESYS runs it to 'abcdefghij') types UNKNOWN in the front-end — the selection's meet of two STRINGs of
  different capacities (`types/builtins` `selectionValueArguments`). Fixture `string_inout_wider_reads`, a named ceiling exception
  (`test/frontend/baseline.ts`, `call UNKNOWN`, both vendors) removed when SEL / MUX / LIMIT over strings is typed (the meet's
  capacity measured first).
  - Done 2026-10-11. Measured by storing each into an INT (`sel_string_meet_type`, `limit_string_meet_type`, `_in`; record:language, both vendors identical): SEL / MUX answer the widest value argument's type (a sizeless one is 80; a literal wider than every variable is named `STRING(INT#20)`), LIMIT its IN's type, MIN / MAX a sizeless STRING. `types/infer/expr` `stringSelection` types them (MIN / MAX over WSTRINGs stays UNKNOWN, unmeasured); the `string_inout_wider_reads` exception removed.
