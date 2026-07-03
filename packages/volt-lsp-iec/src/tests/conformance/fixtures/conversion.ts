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
import type { LanguageTest } from "../types.js";

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
		note: "TC behavior CONFIRMED VIA SOLO PUSH: `[error] Cannot convert type 'REAL' to type 'INT'`. In the 69-test batch recording, this error went missing — proves the bridge BuildHandler's pane scanner drops diagnostics under load (truncation, regex format variation, or TC's own per-POU attribution gets fuzzy). Conformance failure is the correct signal: don't trust the batch recording for THIS test; use solo-push to confirm. Future work: dump raw pane text in batch mode to fix the bridge scanner.",
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
		note: "Per docs §1 'Implicit conversion from larger to smaller types is NOT permitted'. Earlier small-batch recording confirmed TC errors. Full 69-test batch reports clean — same bridge-scanner batch-fidelity issue as conversion_int_to_real_wrong_source.",
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

	// ─── BOOL ↔ numeric conversion (must be explicit) ───────────────

	{
		name: "conversion_bool_to_int_valid",
		pouName: "FB_LANG_conversion_bool_to_int_valid",
		kind: "function_block",
		feature: "BOOL_TO_INT — explicit BOOL → INT widening (FALSE→0, TRUE→1)",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_b2i : FB_LANG_conversion_bool_to_int_valid;",
		plcPrgBody: "fb_b2i.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_bool_to_int_valid
VAR
	bFlag : BOOL := TRUE;
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iValue := BOOL_TO_INT(bFlag);
END_METHOD
`,
	},

	{
		name: "conversion_int_to_bool_valid",
		pouName: "FB_LANG_conversion_int_to_bool_valid",
		kind: "function_block",
		feature: "INT_TO_BOOL — explicit INT → BOOL (0→FALSE, non-zero→TRUE)",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_i2b : FB_LANG_conversion_int_to_bool_valid;",
		plcPrgBody: "fb_i2b.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_int_to_bool_valid
VAR
	iValue : INT := 42;
	bFlag : BOOL;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
bFlag := INT_TO_BOOL(iValue);
END_METHOD
`,
	},

	// ─── TIME / DATE / TOD / DT conversions ─────────────────────────

	{
		name: "conversion_time_to_dword",
		pouName: "FB_LANG_conversion_time_to_dword",
		kind: "function_block",
		feature: "TIME_TO_DWORD — read TIME's underlying millisecond count",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_t2d : FB_LANG_conversion_time_to_dword;",
		plcPrgBody: "fb_t2d.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_time_to_dword
VAR
	tDuration : TIME := T#5S;
	dwMs : DWORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
dwMs := TIME_TO_DWORD(tDuration);
END_METHOD
`,
	},

	{
		name: "conversion_date_to_string",
		pouName: "FB_LANG_conversion_date_to_string",
		kind: "function_block",
		feature: "DATE_TO_STRING — format a DATE as 'YYYY-MM-DD'",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_d2s : FB_LANG_conversion_date_to_string;",
		plcPrgBody: "fb_d2s.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_date_to_string
VAR
	dDate : DATE := D#2026-05-29;
	sFormatted : STRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
sFormatted := DATE_TO_STRING(dDate);
END_METHOD
`,
	},

	{
		name: "conversion_dt_to_date",
		pouName: "FB_LANG_conversion_dt_to_date",
		kind: "function_block",
		feature: "DT_TO_DATE — drop the time component from a DT",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_dt2d : FB_LANG_conversion_dt_to_date;",
		plcPrgBody: "fb_dt2d.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_dt_to_date
VAR
	dtStamp : DT := DT#2026-05-29-12:30:00;
	dOnly : DATE;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
dOnly := DT_TO_DATE(dtStamp);
END_METHOD
`,
	},

	// ─── TRUNC / TRUNC_INT ──────────────────────────────────────────

	{
		name: "conversion_trunc_real_to_dint",
		pouName: "FB_LANG_conversion_trunc",
		kind: "function_block",
		feature: "TRUNC — REAL → DINT truncation toward zero",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_tr : FB_LANG_conversion_trunc;",
		plcPrgBody: "fb_tr.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_trunc
VAR
	rValue : REAL := 7.9;
	diTruncated : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
diTruncated := TRUNC(rValue);
END_METHOD
`,
	},

	{
		name: "conversion_trunc_int_real_to_int",
		pouName: "FB_LANG_conversion_trunc_int",
		kind: "function_block",
		feature: "TRUNC_INT — REAL → INT truncation toward zero",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_tri : FB_LANG_conversion_trunc_int;",
		plcPrgBody: "fb_tri.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_trunc_int
VAR
	rValue : REAL := -3.7;
	iTruncated : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iTruncated := TRUNC_INT(rValue);
END_METHOD
`,
	},

	// ─── Overloaded TO_<type> ───────────────────────────────────────

	{
		name: "conversion_overloaded_to_int",
		pouName: "FB_LANG_conversion_overloaded_to_int",
		kind: "function_block",
		feature: "TO_INT(<any>) — overloaded conversion (source type inferred)",
		fromDoc: "04-type-conversion.md",
		expectTcAccepts: true,
		note: "TO_<type> form accepts any compatible source — TC infers based on operand type.",
		plcPrgVar: "fb_to : FB_LANG_conversion_overloaded_to_int;",
		plcPrgBody: "fb_to.Convert();",
		source:
`FUNCTION_BLOCK FB_LANG_conversion_overloaded_to_int
VAR
	diSrc : DINT := 1000;
	iDst : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Convert
iDst := TO_INT(diSrc);
END_METHOD
`,
	},
];
