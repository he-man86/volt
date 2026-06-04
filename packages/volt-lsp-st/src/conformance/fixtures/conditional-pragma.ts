/**
 * Conditional-pragma conformance tests.
 *
 * Source: 07-pragmas.md (§ Conditional pragmas).
 *
 * **Latest recording (2026-05-29):** TC ACCEPTS `{define}` /
 * `{IF defined(...)}` / `{ELSIF}` / `{ELSE}` / `{END_IF}` inside a
 * standalone METHOD body cleanly — buildSuccess=true, zero diagnostics.
 * (Earlier recordings saw "Unexpected Pragma" errors; likely caused by
 * batch-mode TC fidelity issues where parse errors in OTHER tests in
 * the same batch short-circuited semantic analysis for the whole
 * project. Solo / clean batch recordings prove TC handles these
 * correctly.)
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

export const CONDITIONAL_PRAGMA_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 07-pragmas.md (§ Conditional pragmas)
	// ========================================================================

	{
		name: "conditional_define_then_if",
		pouName: "FB_LANG_conditional_define_then_if",
		kind: "function_block",
		feature: "{define X} followed by {IF defined(X)} — IF branch selected",
		fromDoc: "07-pragmas.md#conditional-pragmas",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "{define} establishes a compile-time flag; {IF defined(X)} compiles its body. The ELSE branch contains deliberately-broken text that the preprocessor strips — TC accepts cleanly, proving the preprocessor is active in METHOD bodies.",
		plcPrgVar: "fb_cdti : FB_LANG_conditional_define_then_if;",
		plcPrgBody: "fb_cdti.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_conditional_define_then_if
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{define MY_FLAG}
{IF defined (MY_FLAG)}
iCounter := 42;
{ELSE}
this_is_not_valid_st_at_all_xyz_999;
{END_IF}
END_METHOD
`,
	},

	{
		name: "conditional_else_branch_taken",
		pouName: "FB_LANG_conditional_else_branch_taken",
		kind: "function_block",
		feature: "{IF defined(X)} with X NOT defined — ELSE branch taken",
		fromDoc: "07-pragmas.md#conditional-pragmas",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "Without a {define}, the IF branch is stripped and ELSE compiled. IF branch contains gibberish that never reaches the compiler. TC accepts cleanly.",
		plcPrgVar: "fb_cebt : FB_LANG_conditional_else_branch_taken;",
		plcPrgBody: "fb_cebt.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_conditional_else_branch_taken
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{IF defined (NEVER_DEFINED_FLAG_XYZ_999)}
this_should_be_stripped_and_never_compiled_abc;
{ELSE}
iCounter := 1;
{END_IF}
END_METHOD
`,
	},

	{
		name: "conditional_elsif_chain",
		pouName: "FB_LANG_conditional_elsif_chain",
		kind: "function_block",
		feature: "{IF}/{ELSIF}/{ELSE}/{END_IF} chain — middle branch selected",
		fromDoc: "07-pragmas.md#conditional-pragmas",
		expectTcAccepts: true,
		recordIsolated: true,
		plcPrgVar: "fb_cec : FB_LANG_conditional_elsif_chain;",
		plcPrgBody: "fb_cec.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_conditional_elsif_chain
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{define PICK_MIDDLE}
{IF defined (NEVER)}
broken_first_branch_xyz;
{ELSIF defined (PICK_MIDDLE)}
iCounter := 2;
{ELSE}
broken_else_branch_xyz;
{END_IF}
END_METHOD
`,
	},

	{
		name: "conditional_orphan_else",
		pouName: "FB_LANG_conditional_orphan_else",
		kind: "function_block",
		feature: "Bare {ELSE} / {END_IF} without any preceding {IF} — orphan structure",
		fromDoc: "07-pragmas.md#conditional-pragmas",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "Both TC and LSP should flag the orphan {ELSE} (LSP's orphanConditionalPragma check mirrors TC's 'Unexpected Pragma' error). Pure structural check — no compile-time predicate evaluation needed.",
		plcPrgVar: "fb_coe : FB_LANG_conditional_orphan_else;",
		plcPrgBody: "fb_coe.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_conditional_orphan_else
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
iCounter := 1;
{ELSE}
iCounter := 2;
{END_IF}
END_METHOD
`,
	},

	{
		name: "conditional_undefine_after_define",
		pouName: "FB_LANG_conditional_undefine_after_define",
		kind: "function_block",
		feature: "{define X} ... {undefine X} ... {IF defined(X)} — IF should be false",
		fromDoc: "07-pragmas.md#conditional-pragmas",
		expectTcAccepts: true,
		recordIsolated: true,
		plcPrgVar: "fb_cuad : FB_LANG_conditional_undefine_after_define;",
		plcPrgBody: "fb_cuad.Run();",
		source:
`FUNCTION_BLOCK FB_LANG_conditional_undefine_after_define
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{define TEMP_FLAG}
{undefine TEMP_FLAG}
{IF defined (TEMP_FLAG)}
broken_should_be_stripped_xyz;
{ELSE}
iCounter := 3;
{END_IF}
END_METHOD
`,
	},
];
