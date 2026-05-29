/**
 * OOP (EXTENDS) conformance tests.
 *
 * Source: 10-keywords.md + various ST OO docs. Covers
 * inheritance, method overrides, ABSTRACT / FINAL modifiers, and
 * SUPER access.
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./pragma-tests.js";

export const OOP_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: OOP — EXTENDS / SUPER / FINAL / ABSTRACT / OVERRIDE
	// ========================================================================

	// Base FB everyone else extends. Acts as scaffolding for the
	// derived-FB tests below.
	{
		name: "oop_base",
		pouName: "FB_LANG_oop_base",
		kind: "function_block",
		feature: "Base FB with a method — scaffolding for inheritance tests",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_base : FB_LANG_oop_base;",
		plcPrgBody: "fb_base.Greet();",
		source:
`FUNCTION_BLOCK FB_LANG_oop_base
VAR
	iValue : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Greet
iValue := iValue + 1;
END_METHOD
`,
	},

	{
		name: "oop_extends_simple",
		pouName: "FB_LANG_oop_extends_simple",
		kind: "function_block",
		feature: "FB EXTENDS base — inherits its method",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_extsimple : FB_LANG_oop_extends_simple;",
		plcPrgBody: "fb_extsimple.Greet();",
		source:
`FUNCTION_BLOCK FB_LANG_oop_extends_simple EXTENDS FB_LANG_oop_base
VAR
	iExtraField : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "oop_extends_with_override",
		pouName: "FB_LANG_oop_extends_with_override",
		kind: "function_block",
		feature: "FB EXTENDS base + OVERRIDE the inherited method",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_extover : FB_LANG_oop_extends_with_override;",
		plcPrgBody: "fb_extover.Greet();",
		source:
`FUNCTION_BLOCK FB_LANG_oop_extends_with_override EXTENDS FB_LANG_oop_base
VAR
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Greet
iLocal := iLocal + 2;
END_METHOD
`,
	},

	{
		name: "oop_extends_with_super",
		pouName: "FB_LANG_oop_extends_with_super",
		kind: "function_block",
		feature: "OVERRIDE method that calls SUPER^.Greet()",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_extsuper : FB_LANG_oop_extends_with_super;",
		plcPrgBody: "fb_extsuper.Greet();",
		source:
`FUNCTION_BLOCK FB_LANG_oop_extends_with_super EXTENDS FB_LANG_oop_base
VAR
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Greet
SUPER^.Greet();
iLocal := iLocal + 3;
END_METHOD
`,
	},

	{
		name: "oop_final_fb",
		pouName: "FB_LANG_oop_final_fb",
		kind: "function_block",
		feature: "FINAL FB — cannot be extended",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_final : FB_LANG_oop_final_fb;",
		plcPrgBody: "fb_final();",
		source:
`FUNCTION_BLOCK FINAL FB_LANG_oop_final_fb
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "oop_abstract_fb",
		pouName: "FB_LANG_oop_abstract_fb",
		kind: "function_block",
		feature: "ABSTRACT FB — can't be directly instantiated",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		note: "ABSTRACT declaration alone is fine; PLC_PRG only references this FB indirectly (no direct instance), so TC accepts. A direct instantiation would error.",
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK ABSTRACT FB_LANG_oop_abstract_fb
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "oop_abstract_instantiated",
		pouName: "FB_LANG_oop_abstract_instantiated",
		kind: "function_block",
		feature: "Trying to instantiate ABSTRACT FB — TC should error",
		fromDoc: "10-keywords.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "Direct instantiation of an ABSTRACT FB violates the OO contract — TC must error. Marked recordIsolated because TC's error refers to FB_LANG_oop_abstract_fb (separate test); we want the error to be about THIS test's bad instantiation.",
		plcPrgVar: "fb_absinst : FB_LANG_oop_abstract_instantiated;",
		plcPrgBody: "fb_absinst.Inner();",
		source:
`FUNCTION_BLOCK ABSTRACT FB_LANG_oop_abstract_instantiated
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Inner
iVar := 1;
END_METHOD
`,
	},
];
