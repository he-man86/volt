/**
 * FB lifecycle conformance test catalog — FB_Init / FB_Reinit / FB_Exit.
 *
 * Source: 11-fb-lifecycle.md. The LSP has a `fbLifecycleSignature`
 * diagnostic that's supposed to catch signature mistakes here; these
 * tests measure whether it actually does (and whether TC agrees).
 *
 * Per the doc's "Diagnostic candidates":
 *   - FB_Init / FB_Reinit / FB_Exit with wrong return type → error
 *   - FB_Init missing bInitRetains + bInCopyCode → error/warning
 *   - FB_Exit missing bInCopyCode → error
 *   - FB_Reinit with parameters → questionable (doc says "no parameters")
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./types.js";

export const LIFECYCLE_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 11-fb-lifecycle.md — FB_Init / FB_Reinit / FB_Exit signatures
	// ========================================================================

	// ─── Positive: canonical signatures TC + LSP must accept ──────────

	{
		name: "fb_init_canonical",
		pouName: "FB_LANG_fb_init_canonical",
		kind: "function_block",
		feature: "FB_Init with canonical (bInitRetains, bInCopyCode) signature",
		fromDoc: "11-fb-lifecycle.md#fb_init",
		expectTcAccepts: true,
		plcPrgVar: "fb_ic : FB_LANG_fb_init_canonical;",
		plcPrgBody: "fb_ic();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_init_canonical
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
iCounter := 0;
END_METHOD
`,
	},

	// NOTE: An "fb_init_with_extra_param" test was attempted here but
	// removed for v1: it requires `fb : FB(iComNum := 1);` instantiation
	// syntax in PLC_PRG's VAR section, which the volt-lsp-st parser
	// doesn't accept (the `(arg := val)` shortcut isn't in its grammar
	// yet). TC supports it. This is a real LSP parser gap worth
	// re-adding once the parser is extended.

	{
		name: "fb_reinit_canonical",
		pouName: "FB_LANG_fb_reinit_canonical",
		kind: "function_block",
		feature: "FB_Reinit with canonical (no-param) signature",
		fromDoc: "11-fb-lifecycle.md#fb_reinit",
		expectTcAccepts: true,
		plcPrgVar: "fb_rc : FB_LANG_fb_reinit_canonical;",
		plcPrgBody: "fb_rc.FB_Reinit();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_reinit_canonical
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Reinit : BOOL
iCounter := 0;
END_METHOD
`,
	},

	{
		name: "fb_exit_canonical",
		pouName: "FB_LANG_fb_exit_canonical",
		kind: "function_block",
		feature: "FB_Exit with canonical (bInCopyCode) signature",
		fromDoc: "11-fb-lifecycle.md#fb_exit",
		expectTcAccepts: true,
		plcPrgVar: "fb_ec : FB_LANG_fb_exit_canonical;",
		plcPrgBody: "fb_ec();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_exit_canonical
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Exit : BOOL
VAR_INPUT
	bInCopyCode : BOOL;
END_VAR
iCleanup := 0;
END_METHOD
`,
	},

	// ─── Negative: wrong return type ──────────────────────────────────

	{
		name: "fb_init_wrong_return_type",
		pouName: "FB_LANG_fb_init_wrong_return_type",
		kind: "function_block",
		feature: "FB_Init declared with non-BOOL return — should error per docs",
		fromDoc: "11-fb-lifecycle.md#critical-rules",
		expectTcAccepts: true,
		note: "Per docs: 'changing the return type is undefined behavior'. TC may accept it silently; LSP fbLifecycleSignature check is the value-add. Whether TC errors is itself a discovery.",
		plcPrgVar: "fb_iwrt : FB_LANG_fb_init_wrong_return_type;",
		plcPrgBody: "fb_iwrt();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_init_wrong_return_type
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : INT
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
iCounter := 0;
FB_Init := 1;
END_METHOD
`,
	},

	// ─── Negative: missing required params ───────────────────────────

	{
		name: "fb_init_missing_bInCopyCode",
		pouName: "FB_LANG_fb_init_missing_bInCopyCode",
		kind: "function_block",
		feature: "FB_Init missing the bInCopyCode parameter — TC ERRORS",
		fromDoc: "11-fb-lifecycle.md#fb_init",
		expectTcAccepts: false,
		note: "DISCOVERY: TC errors with 'An FB_Init-Method of a functionblock needs two inputs bInitRetains and bInCopyCode of type BOOL'. The error was originally missed because the bridge BuildHandler regex required a (line) group — TC writes these structural errors without line numbers. Regex fixed.",
		plcPrgVar: "fb_imb : FB_LANG_fb_init_missing_bInCopyCode;",
		plcPrgBody: "fb_imb();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_init_missing_bInCopyCode
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
END_VAR
iCounter := 0;
END_METHOD
`,
	},

	{
		name: "fb_exit_missing_bInCopyCode",
		pouName: "FB_LANG_fb_exit_missing_bInCopyCode",
		kind: "function_block",
		feature: "FB_Exit missing the bInCopyCode parameter — TC ERRORS per docs",
		fromDoc: "11-fb-lifecycle.md#fb_exit",
		expectTcAccepts: false,
		note: "DISCOVERY: TC errors with 'An FB_Exit-Method of a functionblock needs an input bInCopyCode of type BOOL'. Captured after the bridge regex fix (line-numberless structural errors).",
		plcPrgVar: "fb_emb : FB_LANG_fb_exit_missing_bInCopyCode;",
		plcPrgBody: "fb_emb();",
		source:
`FUNCTION_BLOCK FB_LANG_fb_exit_missing_bInCopyCode
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Exit : BOOL
VAR_INPUT
END_VAR
iCleanup := 0;
END_METHOD
`,
	},

	// ─── Edge case: FB_Reinit declared WITH params (docs say "no parameters") ──

	{
		name: "fb_reinit_with_params",
		pouName: "FB_LANG_fb_reinit_with_params",
		kind: "function_block",
		feature: "FB_Reinit declared with VAR_INPUT — docs say no params",
		fromDoc: "11-fb-lifecycle.md#fb_reinit",
		expectTcAccepts: true,
		note: "Docs comment '(* no parameters *)' — but adding them may be silently accepted by TC. Disagreement is a discovery: should LSP flag this?",
		plcPrgVar: "fb_rwp : FB_LANG_fb_reinit_with_params;",
		plcPrgBody: "fb_rwp.FB_Reinit(iSeed := 1);",
		source:
`FUNCTION_BLOCK FB_LANG_fb_reinit_with_params
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Reinit : BOOL
VAR_INPUT
	iSeed : INT;
END_VAR
iCounter := iSeed;
END_METHOD
`,
	},
];
