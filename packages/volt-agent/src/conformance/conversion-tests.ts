/**
 * Type conversion conformance tests.
 *
 * Source: 04-type-conversion.md. The LSP has a
 * `conversionSourceMismatch` check that flags `<X>_TO_<Y>(arg)` where
 * arg's declared type isn't `<X>`. TC's stance on this varies — some
 * mismatches are silently auto-coerced, some are errors.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./pragma-tests.js";

export const CONVERSION_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 04-type-conversion.md — conversion operator checks
	// ========================================================================

	// ─── Positive: correct source type ──────────────────────────────────

	{
		name: "conversion_int_to_real_valid",
		pouName: "FB_LANG_conversion_int_to_real_valid",
		kind: "function_block",
		feature: "INT_TO_REAL with an INT argument — correct shape",
		fromDoc: "04-type-conversion.md#naming-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_itr_v : FB_LANG_conversion_int_to_real_valid;",
		plcPrgBody: "fb_itr_v.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_int_to_real_valid
VAR
	iSrc : INT;
	rDst : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
rDst := INT_TO_REAL(iSrc);
END_METHOD
`,
	},

	{
		name: "conversion_real_to_int_valid",
		pouName: "FB_LANG_conversion_real_to_int_valid",
		kind: "function_block",
		feature: "REAL_TO_INT with a REAL argument — correct shape",
		fromDoc: "04-type-conversion.md#naming-pattern",
		expectTcAccepts: true,
		plcPrgVar: "fb_rti_v : FB_LANG_conversion_real_to_int_valid;",
		plcPrgBody: "fb_rti_v.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_real_to_int_valid
VAR
	rSrc : REAL;
	iDst : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iDst := REAL_TO_INT(rSrc);
END_METHOD
`,
	},

	// ─── Negative: source type doesn't match converter ──────────────────

	{
		name: "conversion_int_to_real_wrong_source",
		pouName: "FB_LANG_conversion_int_to_real_wrong_source",
		kind: "function_block",
		feature: "INT_TO_REAL called with a REAL — source type mismatch",
		fromDoc: "04-type-conversion.md#critical-rules",
		expectTcAccepts: false,
		note: "DISCOVERY: TC ERRORS here. Calling a typed converter with the wrong source type isn't auto-coerced (at least for REAL → INT_TO_*). LSP conversionSourceMismatch check is corroborated.",
		plcPrgVar: "fb_itr_w : FB_LANG_conversion_int_to_real_wrong_source;",
		plcPrgBody: "fb_itr_w.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_int_to_real_wrong_source
VAR
	rSrc : REAL;
	rDst : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
rDst := INT_TO_REAL(rSrc);
END_METHOD
`,
	},

	{
		name: "conversion_dint_to_int_wrong_source",
		pouName: "FB_LANG_conversion_dint_to_int_wrong_source",
		kind: "function_block",
		feature: "DINT_TO_INT called with an INT — source type mismatch",
		fromDoc: "04-type-conversion.md#critical-rules",
		expectTcAccepts: true,
		note: "Implicit upgrade INT→DINT may be auto-coerced by TC. LSP conversionSourceMismatch surfaces the intent error.",
		plcPrgVar: "fb_dti_w : FB_LANG_conversion_dint_to_int_wrong_source;",
		plcPrgBody: "fb_dti_w.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_dint_to_int_wrong_source
VAR
	iSrc : INT;
	iDst : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iDst := DINT_TO_INT(iSrc);
END_METHOD
`,
	},

	// ─── Negative: implicit narrowing (docs §1: not permitted) ──────────

	{
		name: "conversion_implicit_dint_to_int",
		pouName: "FB_LANG_conversion_implicit_dint_to_int",
		kind: "function_block",
		feature: "Direct assignment DINT → INT — implicit narrowing, per docs not permitted",
		fromDoc: "04-type-conversion.md#critical-rules",
		expectTcAccepts: false,
		note: "Per docs §1 'Implicit conversion from larger to smaller types is NOT permitted'. TC should error; LSP conversionSourceMismatch wouldn't fire here (no _TO_ operator). Diagnostic gap candidate.",
		plcPrgVar: "fb_idi : FB_LANG_conversion_implicit_dint_to_int;",
		plcPrgBody: "fb_idi.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_implicit_dint_to_int
VAR
	diSrc : DINT;
	iDst : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iDst := diSrc;
END_METHOD
`,
	},
];
