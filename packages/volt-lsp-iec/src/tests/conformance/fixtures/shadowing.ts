/**
 * Identifier-shadowing conformance tests.
 *
 * Source: 09-shadowing.md. The LSP has a `shadowingDeclaration` check
 * that flags a same-name declaration that shadows an outer-scope
 * symbol. TC is silent on shadowing (the lookup rule "local wins over
 * global" applies without warning).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

export const SHADOWING_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 09-shadowing.md — shadowing detection
	// ========================================================================

	{
		name: "shadowing_method_local_shadows_member",
		pouName: "FB_LANG_shadowing_method_local_shadows_member",
		kind: "function_block",
		feature: "Method-local var has same name as an FB member var (shadows it)",
		fromDoc: "09-shadowing.md",
		expectTcAccepts: true,
		note: "TC: local wins, no warning. LSP shadowingDeclaration should at minimum surface an info-level diagnostic.",
		plcPrgVar: "fb_sh : FB_LANG_shadowing_method_local_shadows_member;",
		plcPrgBody: "fb_sh.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_shadowing_method_local_shadows_member
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
VAR
	iCounter : INT;
END_VAR
iCounter := 1;
END_METHOD
`,
	},

	{
		name: "shadowing_method_param_shadows_member",
		pouName: "FB_LANG_shadowing_method_param_shadows_member",
		kind: "function_block",
		feature: "Method input parameter has same name as FB member var (shadows it)",
		fromDoc: "09-shadowing.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_shp : FB_LANG_shadowing_method_param_shadows_member;",
		plcPrgBody: "fb_shp.Apply(iValue := 1);",
		source:
`FUNCTION_BLOCK FB_LANG_shadowing_method_param_shadows_member
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Apply
VAR_INPUT
	iValue : INT;
END_VAR
iValue := iValue + 1;
END_METHOD
`,
	},

	// ─── Coverage extension for resolver.ts:54-61 (lookupAll across scopes) ─

	{
		name: "shadowing_method_local_shadows_fb_var",
		pouName: "FB_LANG_method_local_shadows",
		kind: "function_block",
		feature: "METHOD VAR shadows an FB VAR with the same name — exercises lookupAll's nested-scope walk",
		fromDoc: "09-shadowing.md",
		expectTcAccepts: true,
		note: "TC accepts shadowing here (the LSP shadowingDeclaration check ships OFF by default per LSP-mirrors-TC). The cross-scope lookupAll path is exercised by hovering on iCount inside the method — it returns the local first then the FB var.",
		plcPrgVar: "fb_mls : FB_LANG_method_local_shadows;",
		plcPrgBody: "fb_mls.Bump();",
		source:
`FUNCTION_BLOCK FB_LANG_method_local_shadows
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Bump
VAR
	iCount : INT;
END_VAR
iCount := iCount + 1;
THIS^.iCount := THIS^.iCount + 1;
END_METHOD
`,
	},
];
