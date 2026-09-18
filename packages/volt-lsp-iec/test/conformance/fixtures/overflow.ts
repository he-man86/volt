/**
 * Constant / literal overflow conformance tests — a THEORETICAL-GAP catalog.
 *
 * The LSP has no constant-range check. Each fixture assigns a literal outside a type's representable range
 * (INT > 32767, BYTE > 255, unsigned < 0, a typed literal `INT#40000`) so the recorder captures the
 * compiler's verdict — the oracle for a future `constantOverflow` check and its exact message. Positive
 * baselines (max value in range) confirm the boundary is inclusive.
 *
 * See types.ts for the field docs.
 */
import type { LanguageTest } from "../types.js"

export const OVERFLOW_TESTS: readonly LanguageTest[] = [
  // ─── Signed integer overflow ─────────────────────────────────────────
  {
    name: "overflow_int_at_max",
    pouName: "FB_LANG_overflow_int_at_max",
    kind: "function_block",
    feature: "INT := 32767 — exactly the max (baseline: accepted)",
    fromDoc: "06-data-types.md#integer-data-types",
    plcPrgVar: "fb_iam : FB_LANG_overflow_int_at_max;",
    plcPrgBody: "fb_iam();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_int_at_max
VAR
	value : INT := 32767;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "overflow_int_above_max",
    pouName: "FB_LANG_overflow_int_above_max",
    kind: "function_block",
    feature: "INT := 40000 — above INT max 32767 (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#integer-data-types",
    note: "Oracle: literal overflow of a signed 16-bit INT. Drives a constantOverflow check + message.",
    plcPrgVar: "fb_iabv : FB_LANG_overflow_int_above_max;",
    plcPrgBody: "fb_iabv();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_int_above_max
VAR
	value : INT := 40000;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "overflow_sint_above_max",
    pouName: "FB_LANG_overflow_sint_above_max",
    kind: "function_block",
    feature: "SINT := 200 — above SINT max 127 (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#integer-data-types",
    note: "Oracle: 8-bit signed overflow.",
    plcPrgVar: "fb_ssm : FB_LANG_overflow_sint_above_max;",
    plcPrgBody: "fb_ssm();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_sint_above_max
VAR
	value : SINT := 200;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // ─── Unsigned integer range ──────────────────────────────────────────
  {
    name: "overflow_byte_above_max",
    pouName: "FB_LANG_overflow_byte_above_max",
    kind: "function_block",
    feature: "BYTE := 300 — above BYTE max 255 (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#bit-string-data-types",
    note: "Oracle: 8-bit unsigned overflow.",
    plcPrgVar: "fb_bam : FB_LANG_overflow_byte_above_max;",
    plcPrgBody: "fb_bam();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_byte_above_max
VAR
	value : BYTE := 300;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "overflow_word_above_max",
    pouName: "FB_LANG_overflow_word_above_max",
    kind: "function_block",
    feature: "WORD := 70000 — above WORD max 65535 (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#bit-string-data-types",
    note: "Oracle: 16-bit unsigned overflow.",
    plcPrgVar: "fb_wam : FB_LANG_overflow_word_above_max;",
    plcPrgBody: "fb_wam();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_word_above_max
VAR
	value : WORD := 70000;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "overflow_uint_negative",
    pouName: "FB_LANG_overflow_uint_negative",
    kind: "function_block",
    feature: "UINT := -5 — negative literal into an unsigned type (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#integer-data-types",
    note: "Oracle: negative constant into an unsigned type.",
    plcPrgVar: "fb_un : FB_LANG_overflow_uint_negative;",
    plcPrgBody: "fb_un();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_uint_negative
VAR
	value : UINT := -5;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // ─── Typed literal overflow ──────────────────────────────────────────
  {
    name: "overflow_typed_literal_int",
    pouName: "FB_LANG_overflow_typed_literal_int",
    kind: "function_block",
    feature: "INT#40000 — a typed literal whose value overflows INT (hypothesis: compiler rejects)",
    fromDoc: "06-data-types.md#typed-literals",
    note: "Oracle: typed-literal (INT#) overflow — the value is out of range for the named type.",
    plcPrgVar: "fb_tli : FB_LANG_overflow_typed_literal_int;",
    plcPrgBody: "fb_tli.Set();",
    source: `FUNCTION_BLOCK FB_LANG_overflow_typed_literal_int
VAR
	value : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Set
value := INT#40000;
END_METHOD
`,
  },
  // ─── RUNTIME DOMAIN AND RANGE — unmeasured, and the two backends need ONE answer ────────────────────
  // Everything above is a CONSTANT the compiler can see. These are RUNTIME values, and nothing records what the
  // vendor does with them. Measured in the interpreter 2026-09-17: SQRT(-1) = NaN, LN(0) = -inf, LN(-1) = NaN,
  // 1.0/0.0 = inf — IEEE-754, and plausible but unconfirmed. The conversions are not plausible at all:
  // LREAL_TO_DINT(1.0E30) gives 0, which is neither saturation (2147483647) nor a wrap of any width, and
  // LREAL_TO_LINT(1.0E30) gives 5076964154930102272. Whatever CODESYS answers, BOTH backends must give it —
  // fixing one alone converts a shared bug into a B<->C divergence, which is why these were filed together.
  {
    name: "domain_sqrt_negative",
    pouName: "FB_LANG_domain_sqrt_negative",
    kind: "function_block" as const,
    feature: "SQRT of a negative — NaN, an error, or a stopped task?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_domain_sqrt_negative : FB_LANG_domain_sqrt_negative;",
    plcPrgBody: "fb_domain_sqrt_negative();",
    source: "FUNCTION_BLOCK FB_LANG_domain_sqrt_negative\nVAR\n\tx : REAL := -1.0;\n\tout : REAL;\nEND_VAR\nout := SQRT(x);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "domain_ln_zero",
    pouName: "FB_LANG_domain_ln_zero",
    kind: "function_block" as const,
    feature: "LN(0) — -inf, an error, or a stopped task?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_domain_ln_zero : FB_LANG_domain_ln_zero;",
    plcPrgBody: "fb_domain_ln_zero();",
    source: "FUNCTION_BLOCK FB_LANG_domain_ln_zero\nVAR\n\tx : REAL := 0.0;\n\tout : REAL;\nEND_VAR\nout := LN(x);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "domain_ln_negative",
    pouName: "FB_LANG_domain_ln_negative",
    kind: "function_block" as const,
    feature: "LN of a negative — NaN, an error, or a stopped task?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_domain_ln_negative : FB_LANG_domain_ln_negative;",
    plcPrgBody: "fb_domain_ln_negative();",
    source: "FUNCTION_BLOCK FB_LANG_domain_ln_negative\nVAR\n\tx : REAL := -1.0;\n\tout : REAL;\nEND_VAR\nout := LN(x);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "domain_divide_real_by_zero",
    pouName: "FB_LANG_domain_divide_real_by_zero",
    kind: "function_block" as const,
    feature: "a REAL divided by a REAL zero — inf, an error, or a stopped task?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_domain_divide_real_by_zero : FB_LANG_domain_divide_real_by_zero;",
    plcPrgBody: "fb_domain_divide_real_by_zero();",
    source: "FUNCTION_BLOCK FB_LANG_domain_divide_real_by_zero\nVAR\n\tz : REAL := 0.0;\n\tout : REAL;\nEND_VAR\nout := 1.0 / z;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "domain_nan_propagates",
    pouName: "FB_LANG_domain_nan_propagates",
    kind: "function_block" as const,
    feature: "does a NaN survive further arithmetic, and what does comparing it say?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_domain_nan_propagates : FB_LANG_domain_nan_propagates;",
    plcPrgBody: "fb_domain_nan_propagates();",
    source: "FUNCTION_BLOCK FB_LANG_domain_nan_propagates\nVAR\n\tx : REAL := -1.0;\n\tout : REAL;\n\tisGreater : BOOL;\n\tisEqual : BOOL;\nEND_VAR\nout := SQRT(x) + 1.0;\nisGreater := SQRT(x) > 0.0;\nisEqual := SQRT(x) = SQRT(x);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_dint_above_range",
    pouName: "FB_LANG_real_to_dint_above_range",
    kind: "function_block" as const,
    feature: "LREAL 1.0E30 to DINT — saturate, wrap, or something else?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_above_range : FB_LANG_real_to_dint_above_range;",
    plcPrgBody: "fb_real_to_dint_above_range();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_above_range\nVAR\n\tf : LREAL := 1.0E30;\n\tn : DINT;\nEND_VAR\nn := LREAL_TO_DINT(f);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_dint_below_range",
    deferred: { transpile: "2026-09-18: LREAL_TO_DINT(-1.0E30) records -2147483648 where the measured model (to a 64-bit register, indefinite on overflow, then wrap) says 0 - the model the other four points fit, including LREAL_TO_DINT(1.0E30) = 0 with only the SIGN different. One conversion cannot give both, so one of the two is likely folded at compile time; real_to_dint_runtime_* are written to tell them apart." },
    pouName: "FB_LANG_real_to_dint_below_range",
    kind: "function_block" as const,
    feature: "LREAL -1.0E30 to DINT — saturate, wrap, or something else?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_below_range : FB_LANG_real_to_dint_below_range;",
    plcPrgBody: "fb_real_to_dint_below_range();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_below_range\nVAR\n\tf : LREAL := -1.0E30;\n\tn : DINT;\nEND_VAR\nn := LREAL_TO_DINT(f);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_lint_above_range",
    pouName: "FB_LANG_real_to_lint_above_range",
    kind: "function_block" as const,
    feature: "LREAL 1.0E30 to LINT — above i64 too, where the interpreter wraps",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_lint_above_range : FB_LANG_real_to_lint_above_range;",
    plcPrgBody: "fb_real_to_lint_above_range();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_lint_above_range\nVAR\n\tf : LREAL := 1.0E30;\n\tn : LINT;\nEND_VAR\nn := LREAL_TO_LINT(f);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_int_at_range",
    pouName: "FB_LANG_real_to_int_at_range",
    kind: "function_block" as const,
    feature: "LREAL 32767.0 to INT — the in-range baseline the three above are read against",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_int_at_range : FB_LANG_real_to_int_at_range;",
    plcPrgBody: "fb_real_to_int_at_range();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_int_at_range\nVAR\n\tf : LREAL := 32767.0;\n\tn : INT;\nEND_VAR\nn := LREAL_TO_INT(f);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_dint_nan",
    pouName: "FB_LANG_real_to_dint_nan",
    kind: "function_block" as const,
    feature: "a NaN converted to DINT — 0, a saturation, or an error?",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_nan : FB_LANG_real_to_dint_nan;",
    plcPrgBody: "fb_real_to_dint_nan();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_nan\nVAR\n\tx : REAL := -1.0;\n\tn : DINT;\nEND_VAR\nn := REAL_TO_DINT(SQRT(x));\nEND_FUNCTION_BLOCK\n",
  },
  // ─── IS THE CONVERSION FOLDED, OR RUN? ─────────────────────────────────────────────────────────────
  // The four recorded points fit one model — REAL to integer goes through a 64-bit register whose out-of-range and
  // NaN answer is i64::MIN, and the result then wraps into the target:
  //     LREAL_TO_DINT(3.0E9) = -1294967296 · LREAL_TO_DINT(1.0E30) = 0 · LREAL_TO_LINT(1.0E30) = i64::MIN ·
  //     REAL_TO_DINT(NaN) = 0
  // The fifth does not: LREAL_TO_DINT(-1.0E30) records -2147483648, where the model says 0 — and the only difference
  // from the 1.0E30 case that DOES fit is the sign. One conversion cannot answer both, so the likeliest reading is
  // that one of them is folded at compile time from its initializer.
  //
  // These put the SAME magnitudes behind arithmetic no compiler folds: the value is built from a variable at run time
  // (`grow` is 1.0 at entry, so each product is the same number the initializer would have given). If the runtime
  // answers differ from the recorded ones, the split is real and the model holds for execution.
  {
    name: "real_to_dint_runtime_above",
    pouName: "FB_LANG_real_to_dint_runtime_above",
    kind: "function_block" as const,
    feature: "LREAL 1.0E30 to DINT, built at RUN TIME - same magnitude as real_to_dint_above_range",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_runtime_above : FB_LANG_real_to_dint_runtime_above;",
    plcPrgBody: "fb_real_to_dint_runtime_above();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_runtime_above\nVAR\n\tgrow : LREAL := 1.0;\n\tbig : LREAL;\n\tn : DINT;\nEND_VAR\nbig := 1.0E15 * 1.0E15 * grow;\nn := LREAL_TO_DINT(big);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_dint_runtime_below",
    deferred: { transpile: "2026-09-18: the RUNTIME value matches the constant one exactly (-2147483648 where the model says 0), so it is NOT compile-time folding — the sign asymmetry is genuine runtime behaviour. See real_to_dint_below_range." },
    pouName: "FB_LANG_real_to_dint_runtime_below",
    kind: "function_block" as const,
    feature: "LREAL -1.0E30 to DINT, built at RUN TIME - the point the model does not explain",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_runtime_below : FB_LANG_real_to_dint_runtime_below;",
    plcPrgBody: "fb_real_to_dint_runtime_below();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_runtime_below\nVAR\n\tgrow : LREAL := 1.0;\n\tbig : LREAL;\n\tn : DINT;\nEND_VAR\nbig := -1.0E15 * 1.0E15 * grow;\nn := LREAL_TO_DINT(big);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_lint_runtime_above",
    pouName: "FB_LANG_real_to_lint_runtime_above",
    kind: "function_block" as const,
    feature: "LREAL 1.0E30 to LINT, built at RUN TIME",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_lint_runtime_above : FB_LANG_real_to_lint_runtime_above;",
    plcPrgBody: "fb_real_to_lint_runtime_above();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_lint_runtime_above\nVAR\n\tgrow : LREAL := 1.0;\n\tbig : LREAL;\n\tn : LINT;\nEND_VAR\nbig := 1.0E15 * 1.0E15 * grow;\nn := LREAL_TO_LINT(big);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "real_to_dint_runtime_in_range",
    pouName: "FB_LANG_real_to_dint_runtime_in_range",
    kind: "function_block" as const,
    feature: "LREAL 3.0E9 to DINT, built at RUN TIME - the in-range control, recorded as a wrap",
    fromDoc: "runtime-domain",
    plcPrgVar: "fb_real_to_dint_runtime_in_range : FB_LANG_real_to_dint_runtime_in_range;",
    plcPrgBody: "fb_real_to_dint_runtime_in_range();",
    source: "FUNCTION_BLOCK FB_LANG_real_to_dint_runtime_in_range\nVAR\n\tgrow : LREAL := 1.0;\n\tmid : LREAL;\n\tn : DINT;\nEND_VAR\nmid := 3.0E9 * grow;\nn := LREAL_TO_DINT(mid);\nEND_FUNCTION_BLOCK\n",
  },
]
