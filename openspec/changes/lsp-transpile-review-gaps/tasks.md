# Tasks: lsp-transpile-review-gaps

Paths are relative to `packages/volt-lsp-iec/`. Each task is one LSP-only finding of the transpiler work, filed by
`transpile-restructure` (its design.md §7.1 and every task there whose acceptance says "Filed"). A task closes when the LSP gives
the recorded answer and the fixture's mark is gone (the expected-failure guard enforces both). Recordings are the oracle: a task
never changes a recording or a fixture's expectation to match the LSP.

## 1. Initial list (transpile-restructure design.md §7.1, created by its task 0.7 on 2026-10-07)

- [ ] 1.1 RC 13 — the LSP accepts a FOR limit wider than the counter.
  - What: CODESYS refuses `FOR i : INT := … TO <DINT>` with "Cannot convert type 'DINT' to type 'INT'" (a DINT variable, a DINT
    expression, `UPPER_BOUND`); a UINT counter's `n - 1` limit it compiles (`for_limit_wider_than_counter_uint_expr`, confirmed).
    The LSP says nothing.
  - Fixtures: `for_limit_wider_than_counter_dint_var`, `for_limit_wider_than_counter_dint_expr`,
    `for_limit_wider_than_counter_upper_bound` (`test/conformance/fixtures/semantics/execution.ts`; `lsp-gap`, held by
    `fixtures.test.ts` `MEASURED_SILENT`, recorded 2026-09-29 for transpile-review task 13).
  - Accept: the three rate `refused` (the LSP reports the recorded message); removed from `MEASURED_SILENT`;
    `for_limit_wider_than_counter_uint_expr` stays confirmed with no LSP error.
  - Transpiler half: transpile-restructure 2.6.
- [ ] 1.2 RC 35 — the LSP accepts a FOR step the counter's type cannot hold.
  - What: CODESYS refuses a runtime INT step on a BYTE counter ("Cannot convert type 'INT' to type 'BYTE'") and a constant step 300
    on a SINT counter ("… to type 'SINT'"). The LSP says nothing.
  - Fixtures: `tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` (`test/conformance/fixtures/semantics/execution.ts`;
    `lsp-gap`, `MEASURED_SILENT`, recorded 2026-09-29).
  - Accept: both rate `refused`; removed from `MEASURED_SILENT`; the confirmed FOR-step fixtures (`tr_35_for_byte_step_255`,
    `callshape_for_runtime_step`) stay free of LSP errors.
  - Transpiler half: transpile-restructure 2.4.
- [x] 1.3 RC 37 — CASE labels outside the selector type and inverted ranges.
  - Fixtures: `tr_37_case_label_wraps_300`, `tr_37_case_label_wraps_minus_212`, `tr_37_case_range_inverted`,
    `tr_37_case_range_beyond_type`.
  - Done before this change existed: RC 37 was closed in the LSP and lowering by `transpile-review-2026-09-29` (194319e648); all four
    rate `refused` in `map.generated.ts` (CODESYS refuses, the LSP reports an error), none is in `MEASURED_SILENT`. Listed because
    transpile-restructure design.md §7.1 names it; nothing is owed here. Transpiler half: transpile-restructure 6.12 (verify).
- [ ] 1.4 RC 20 — the LSP false positive on a FUNCTION's VAR_OUTPUT binding.
  - What: CODESYS builds and RUNS `tr_20_output_index_moved_by_callee`; the LSP reports `'o' is no output of 'F_CS_OUT20'` and a
    wrong input count for the FUNCTION's `o => arr2[gCsK20]` output binding. The call check does not read a FUNCTION's VAR_OUTPUT.
  - Fixtures: `tr_20_output_index_moved_by_callee` (`test/conformance/fixtures/calls/call-shapes.ts`; confirmed, held by
    `test/conformance/support/divergences.ts` `KNOWN_DIVERGENCES.codesys`, recorded 2026-09-29).
  - Accept: the LSP reports nothing on the fixture; it leaves `KNOWN_DIVERGENCES.codesys`; a src test beside the call check.
  - Transpiler half: transpile-restructure 4.11.
- [ ] 1.5 RC 38 — the LSP half of implicit STRING↔WSTRING and non-string→STRING refusals, if transpile-restructure 6.13 finds one.
  - What: on 2026-10-07 the LSP already refuses the listed fixtures (`string_wstring_mixing`, every `uop_*`,
    `standard_len_wstring_rejected` rate `refused`), so there is no known LSP half. transpile-restructure 6.13 (stores, chain links,
    stores through a REFERENCE, arguments, compares) appends here any shape it records that the LSP accepts; if it finds none, 6.13
    ticks this task with that result.
  - Fixtures: `string_wstring_mixing`, `uop_*`, and whatever 6.13 records.
  - Accept: every shape 6.13 files rates `refused`, or this task is ticked by 6.13 with "no LSP half found".

## 2. Filed later

Appended by transpile-restructure steps, one line each, in the commit that finds the gap.
