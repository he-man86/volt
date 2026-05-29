/**
 * Identifier-rules conformance tests.
 *
 * Source: 08-identifiers.md. The LSP has three dedicated checks:
 *   - reservedKeyword: identifier matches a CODESYS reserved keyword
 *   - doubleUnderscore: identifier starts with `__` (system-reserved)
 *   - consecutiveUnderscores: identifier contains `__` anywhere
 *
 * Each test pushes an FB that uses a non-conforming identifier in a
 * VAR section. TC and LSP responses are compared.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./pragma-tests.js";

export const IDENTIFIER_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 08-identifiers.md — identifier-rules checks
	// ========================================================================

	{
		name: "identifier_double_underscore",
		pouName: "FB_LANG_identifier_double_underscore",
		kind: "function_block",
		feature: "Identifier prefixed with __ (system-reserved per docs)",
		fromDoc: "08-identifiers.md#hard-rules",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY: TC enforces this strictly — errors out the build with multiple diagnostics. Catalog initially assumed silent acceptance; conformance run corrected the expectation. Marked recordIsolated: this test produces PARSE errors that, in mega-batch, would block semantic analysis on OTHER tests (their errors silently disappear from the pane).",
		plcPrgVar: "fb_du : FB_LANG_identifier_double_underscore;",
		plcPrgBody: "fb_du();",
		source:
`FUNCTION_BLOCK FB_LANG_identifier_double_underscore
VAR
	__systemReserved : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "identifier_consecutive_underscores",
		pouName: "FB_LANG_identifier_consecutive_underscores",
		kind: "function_block",
		feature: "Identifier with __ in the middle (consecutive underscores)",
		fromDoc: "08-identifiers.md#hard-rules",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY: TC enforces docs §2 strictly — errors out. Same recordIsolated reason as the double-underscore test: parse errors here would short-circuit TC semantic analysis on the rest of the batch.",
		plcPrgVar: "fb_cu : FB_LANG_identifier_consecutive_underscores;",
		plcPrgBody: "fb_cu();",
		source:
`FUNCTION_BLOCK FB_LANG_identifier_consecutive_underscores
VAR
	foo__bar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── Note: identifier_reserved_keyword removed for v1 ─────────────
	// Using a keyword as a variable name (e.g., `INT : BOOL;`) is
	// rejected by the lexer/parser BEFORE the semantic-diagnostic
	// layer runs, so we can't push it via volt push — it'd fail
	// validation in record-language. The LSP reservedKeyword check
	// catches a related case: when an identifier-shaped token (not a
	// keyword) happens to match a reserved word post-lexing. Test
	// that case needs a more contrived source.
];
