/**
 * Literal / operand conformance tests.
 *
 * Sources: 05-operands.md, 06-data-types.md. Validates that TC and LSP
 * agree on the various numeric, time, date, and string literal forms
 * IEC 61131-3 supports. Most are positive cases.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

export const LITERAL_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 05-operands.md + 06-data-types.md — literal forms
	// ========================================================================

	// ─── Numeric literal bases ──────────────────────────────────────────

	{
		name: "literal_hex",
		pouName: "FB_LANG_literal_hex",
		kind: "function_block",
		feature: "Hex literal 16#FF assigned to WORD",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lh : FB_LANG_literal_hex;",
		plcPrgBody: "fb_lh.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_hex
VAR
	wValue : WORD;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
wValue := 16#FF;
END_METHOD
`,
	},

	{
		name: "literal_binary",
		pouName: "FB_LANG_literal_binary",
		kind: "function_block",
		feature: "Binary literal 2#1010 assigned to BYTE",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lb : FB_LANG_literal_binary;",
		plcPrgBody: "fb_lb.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_binary
VAR
	bValue : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
bValue := 2#10101010;
END_METHOD
`,
	},

	{
		name: "literal_octal",
		pouName: "FB_LANG_literal_octal",
		kind: "function_block",
		feature: "Octal literal 8#77 assigned to BYTE",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lo : FB_LANG_literal_octal;",
		plcPrgBody: "fb_lo.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_octal
VAR
	bValue : BYTE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
bValue := 8#77;
END_METHOD
`,
	},

	{
		name: "literal_typed_int_hash",
		pouName: "FB_LANG_literal_typed_int_hash",
		kind: "function_block",
		feature: "Typed-literal form INT#42 (explicit numeric type prefix)",
		fromDoc: "05-operands.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lti : FB_LANG_literal_typed_int_hash;",
		plcPrgBody: "fb_lti.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_typed_int_hash
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
iValue := INT#42;
END_METHOD
`,
	},

	{
		name: "literal_real_scientific",
		pouName: "FB_LANG_literal_real_scientific",
		kind: "function_block",
		feature: "REAL literal in scientific notation: 1.5e3",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lrs : FB_LANG_literal_real_scientific;",
		plcPrgBody: "fb_lrs.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_real_scientific
VAR
	rValue : REAL;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
rValue := 1.5e3;
END_METHOD
`,
	},

	// ─── Time / date / TOD ──────────────────────────────────────────────

	{
		name: "literal_time",
		pouName: "FB_LANG_literal_time",
		kind: "function_block",
		feature: "TIME literal T#5s500ms",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lt : FB_LANG_literal_time;",
		plcPrgBody: "fb_lt.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_time
VAR
	tValue : TIME;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
tValue := T#5s500ms;
END_METHOD
`,
	},

	{
		name: "literal_date",
		pouName: "FB_LANG_literal_date",
		kind: "function_block",
		feature: "DATE literal D#2024-12-25",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ld : FB_LANG_literal_date;",
		plcPrgBody: "fb_ld.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_date
VAR
	dValue : DATE;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
dValue := D#2024-12-25;
END_METHOD
`,
	},

	{
		name: "literal_tod",
		pouName: "FB_LANG_literal_tod",
		kind: "function_block",
		feature: "TIME_OF_DAY literal TOD#12:30:45",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ltod : FB_LANG_literal_tod;",
		plcPrgBody: "fb_ltod.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_tod
VAR
	todValue : TOD;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
todValue := TOD#12:30:45;
END_METHOD
`,
	},

	// ─── Strings ────────────────────────────────────────────────────────

	{
		name: "literal_string_single_quoted",
		pouName: "FB_LANG_literal_string_single_quoted",
		kind: "function_block",
		feature: "STRING literal 'hello' (single-quoted)",
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lssq : FB_LANG_literal_string_single_quoted;",
		plcPrgBody: "fb_lssq.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_string_single_quoted
VAR
	sValue : STRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
sValue := 'hello';
END_METHOD
`,
	},

	{
		name: "literal_wstring_double_quoted",
		pouName: "FB_LANG_literal_wstring_double_quoted",
		kind: "function_block",
		feature: 'WSTRING literal "hello" (double-quoted)',
		fromDoc: "06-data-types.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_lwdq : FB_LANG_literal_wstring_double_quoted;",
		plcPrgBody: "fb_lwdq.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_wstring_double_quoted
VAR
	wsValue : WSTRING;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
wsValue := "hello";
END_METHOD
`,
	},

	// ─── Negative: string-to-INT assignment ─────────────────────────────

	{
		name: "literal_string_to_int_assignment",
		pouName: "FB_LANG_literal_string_to_int_assignment",
		kind: "function_block",
		feature: "STRING literal assigned to INT — TC should error",
		fromDoc: "06-data-types.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "Mismatched literal type. Marked recordIsolated because the parse-style error may otherwise short-circuit other tests in the batch.",
		plcPrgVar: "fb_lsia : FB_LANG_literal_string_to_int_assignment;",
		plcPrgBody: "fb_lsia.Init();",
		source:
`FUNCTION_BLOCK FB_LANG_literal_string_to_int_assignment
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Init
iValue := 'oops';
END_METHOD
`,
	},
];
