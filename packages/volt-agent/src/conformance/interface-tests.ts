/**
 * INTERFACE conformance tests.
 *
 * Source: 10-keywords.md + various ST OO docs. Validates how TC and
 * LSP handle INTERFACE declarations, FBs that IMPLEMENTS them, and
 * common shape patterns (methods, properties, multiple inheritance).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./pragma-tests.js";

export const INTERFACE_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: INTERFACE keyword and IMPLEMENTS contract
	// ========================================================================

	{
		name: "interface_empty",
		pouName: "ITF_LANG_empty",
		kind: "interface",
		feature: "Empty INTERFACE — declaration without methods or properties",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		// Interfaces can't be instantiated directly. PLC_PRG must
		// reference at least one FB that implements them, otherwise
		// TC may drop the interface as unused. We include a tiny
		// stub FB that implements it.
		plcPrgVar: "fb_iei : FB_LANG_interface_empty_impl;",
		plcPrgBody: "fb_iei();",
		source:
`INTERFACE ITF_LANG_empty

END_INTERFACE
`,
	},

	// NOTE: the "empty interface" test needs a companion FB that
	// implements it to keep TC from dropping it. We add that as a
	// separate FB test below. Because the recorder pushes both into
	// the same project, they reference each other naturally.

	{
		name: "interface_empty_impl",
		pouName: "FB_LANG_interface_empty_impl",
		kind: "function_block",
		feature: "FB that IMPLEMENTS the empty interface ITF_LANG_empty",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK FB_LANG_interface_empty_impl IMPLEMENTS ITF_LANG_empty
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "interface_with_method",
		pouName: "ITF_LANG_with_method",
		kind: "interface",
		feature: "INTERFACE with one method declaration",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_iwm : FB_LANG_interface_with_method_impl;",
		plcPrgBody: "fb_iwm.Compute();",
		source:
`INTERFACE ITF_LANG_with_method

METHOD Compute
END_METHOD

END_INTERFACE
`,
	},

	{
		name: "interface_with_method_impl",
		pouName: "FB_LANG_interface_with_method_impl",
		kind: "function_block",
		feature: "FB that IMPLEMENTS ITF_LANG_with_method (must define Compute)",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK FB_LANG_interface_with_method_impl IMPLEMENTS ITF_LANG_with_method
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iCount := iCount + 1;
END_METHOD
`,
	},

	{
		name: "interface_missing_implementation",
		pouName: "FB_LANG_interface_missing_implementation",
		kind: "function_block",
		feature: "FB IMPLEMENTS interface but doesn't define a required method — TC should error",
		fromDoc: "10-keywords.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "Standard OO contract: implementing FB must provide all interface methods. TC errors with 'method not implemented' or similar. Marked recordIsolated because it depends on ITF_LANG_with_method being present.",
		plcPrgVar: "fb_imi : FB_LANG_interface_missing_implementation;",
		plcPrgBody: "fb_imi();",
		source:
`FUNCTION_BLOCK FB_LANG_interface_missing_implementation IMPLEMENTS ITF_LANG_with_method
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},
];
