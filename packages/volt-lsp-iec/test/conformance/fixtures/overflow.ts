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
]
