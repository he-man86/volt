/**
 * Range / bounds conformance tests — a THEORETICAL-GAP catalog.
 *
 * The LSP has no subrange- or array-bounds check today. These fixtures are the hypothesis set: each pins a
 * constant against a declared bound (subrange `INT(lo..hi)`, array `ARRAY[lo..hi]`, enum ordinal) so the
 * recorder captures whether the CODESYS/TwinCAT compiler flags it (error, warning, or silent) — the oracle
 * that decides whether we build a `rangeBounds` check and what message to mirror.
 *
 * Every case is self-contained and, apart from the ONE construct under test, valid — so the recorded verdict
 * isolates that construct. See types.ts for the field docs.
 */
import type { LanguageTest } from "../types.js"

export const RANGE_BOUNDS_TESTS: readonly LanguageTest[] = [
  // ─── Subrange: constant initializer vs declared bounds ──────────────
  {
    name: "subrange_init_in_range",
    pouName: "FB_LANG_subrange_init_in_range",
    kind: "function_block",
    feature: "INT(1..100) initialized to 50 — inside the subrange (baseline: accepted)",
    fromDoc: "06-data-types.md#subrange-types",
    plcPrgVar: "fb_sir : FB_LANG_subrange_init_in_range;",
    plcPrgBody: "fb_sir();",
    source: `FUNCTION_BLOCK FB_LANG_subrange_init_in_range
VAR
	value : INT(1..100) := 50;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "subrange_init_above_range",
    pouName: "FB_LANG_subrange_init_above_range",
    kind: "function_block",
    feature: "INT(1..100) initialized to 200 — above the subrange (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#subrange-types",
    note: "Oracle: does the compiler reject a constant initializer outside the subrange, and with what message? Drives a new rangeBounds check.",
    plcPrgVar: "fb_sar : FB_LANG_subrange_init_above_range;",
    plcPrgBody: "fb_sar();",
    source: `FUNCTION_BLOCK FB_LANG_subrange_init_above_range
VAR
	value : INT(1..100) := 200;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "subrange_init_below_range",
    pouName: "FB_LANG_subrange_init_below_range",
    kind: "function_block",
    feature: "INT(-10..10) initialized to -20 — below the subrange (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#subrange-types",
    note: "Oracle: negative-bound subrange underflow.",
    plcPrgVar: "fb_sbr : FB_LANG_subrange_init_below_range;",
    plcPrgBody: "fb_sbr();",
    source: `FUNCTION_BLOCK FB_LANG_subrange_init_below_range
VAR
	value : INT(-10..10) := -20;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // ─── Subrange: constant assignment in a method body ──────────────────
  {
    name: "subrange_assign_const_out",
    pouName: "FB_LANG_subrange_assign_const_out",
    kind: "function_block",
    feature: "Assigning a constant 200 to an INT(1..100) variable (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#subrange-types",
    note: "Oracle: constant-out-of-subrange on assignment, not just init.",
    plcPrgVar: "fb_saco : FB_LANG_subrange_assign_const_out;",
    plcPrgBody: "fb_saco.Set();",
    source: `FUNCTION_BLOCK FB_LANG_subrange_assign_const_out
VAR
	value : INT(1..100);
END_VAR

END_FUNCTION_BLOCK

METHOD Set
value := 200;
END_METHOD
`,
  },
  // ─── Array: constant index vs declared bounds ────────────────────────
  {
    name: "array_index_const_in_bounds",
    pouName: "FB_LANG_array_index_const_in_bounds",
    kind: "function_block",
    feature: "arr[5] on ARRAY[1..10] — index inside bounds (baseline: accepted)",
    fromDoc: "06-data-types.md#array",
    plcPrgVar: "fb_aib : FB_LANG_array_index_const_in_bounds;",
    plcPrgBody: "fb_aib.Use();",
    source: `FUNCTION_BLOCK FB_LANG_array_index_const_in_bounds
VAR
	arr : ARRAY[1..10] OF INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Use
arr[5] := 1;
END_METHOD
`,
  },
  {
    name: "array_index_const_out_of_bounds",
    pouName: "FB_LANG_array_index_const_out_of_bounds",
    kind: "function_block",
    feature: "arr[20] on ARRAY[1..10] — constant index above bounds (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#array",
    note: "Oracle: constant array-index out of bounds. Both IDEs warn/error on a statically-known OOB index.",
    plcPrgVar: "fb_aob : FB_LANG_array_index_const_out_of_bounds;",
    plcPrgBody: "fb_aob.Use();",
    source: `FUNCTION_BLOCK FB_LANG_array_index_const_out_of_bounds
VAR
	arr : ARRAY[1..10] OF INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Use
arr[20] := 1;
END_METHOD
`,
  },
  {
    name: "array_index_const_below_bounds",
    pouName: "FB_LANG_array_index_const_below_bounds",
    kind: "function_block",
    feature: "arr[0] on ARRAY[1..10] — constant index below lower bound (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#array",
    note: "Oracle: index below the declared lower bound.",
    plcPrgVar: "fb_abb : FB_LANG_array_index_const_below_bounds;",
    plcPrgBody: "fb_abb.Use();",
    source: `FUNCTION_BLOCK FB_LANG_array_index_const_below_bounds
VAR
	arr : ARRAY[1..10] OF INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Use
arr[0] := 1;
END_METHOD
`,
  },
]
