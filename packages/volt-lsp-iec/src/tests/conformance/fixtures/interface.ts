/**
 * INTERFACE conformance tests.
 *
 * Source: 10-keywords.md + various ST OO docs. Validates how TC and
 * LSP handle INTERFACE declarations, FBs that IMPLEMENTS them, and
 * common shape patterns (methods, properties, multiple inheritance).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js";

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
		plcPrgVar: "fb_iei_called : FB_LANG_interface_empty_impl;",
		plcPrgBody: "fb_iei_called();",
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
		plcPrgVar: "fb_iwm_called : FB_LANG_interface_with_method_impl;",
		plcPrgBody: "fb_iwm_called.Compute();",
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
		note: "Standard OO contract: implementing FB must provide all interface methods. TC errors with 'method not implemented'. Must record in BATCH mode (not isolated) so ITF_LANG_with_method is present in the project at the time TC compiles this FB — isolating it pushes the FB alone and TC errors with the wrong message ('No definition found for interface').",
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

	// ─── Coverage extensions for find-identifier.ts:77-100 ────────

	{
		name: "interface_extends_another",
		pouName: "ITF_LANG_extends_another",
		kind: "interface",
		feature: "INTERFACE EXTENDS another interface — extends loop in find-identifier",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_iea : FB_LANG_iea_impl;",
		plcPrgBody: "fb_iea.ExtraDo();",
		source:
`INTERFACE ITF_LANG_extends_another EXTENDS ITF_LANG_empty

METHOD ExtraDo
END_METHOD

END_INTERFACE
`,
	},

	{
		name: "interface_extends_another_impl",
		pouName: "FB_LANG_iea_impl",
		kind: "function_block",
		feature: "FB that IMPLEMENTS an interface which EXTENDS another (must provide all methods)",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK FB_LANG_iea_impl IMPLEMENTS ITF_LANG_extends_another

END_FUNCTION_BLOCK

METHOD ExtraDo
END_METHOD
`,
	},

	{
		name: "interface_method_with_return_type",
		pouName: "ITF_LANG_method_returns",
		kind: "interface",
		feature: "INTERFACE METHOD with a return type — returnType branch in find-identifier",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_imr : FB_LANG_method_returns_impl;\n\tiOut : INT;",
		plcPrgBody: "iOut := fb_imr.GetCount();",
		source:
`INTERFACE ITF_LANG_method_returns

METHOD GetCount : INT
END_METHOD

END_INTERFACE
`,
	},

	{
		name: "interface_method_with_return_type_impl",
		pouName: "FB_LANG_method_returns_impl",
		kind: "function_block",
		feature: "FB implementing an interface whose method has a return type",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK FB_LANG_method_returns_impl IMPLEMENTS ITF_LANG_method_returns
VAR
	iCount : INT := 7;
END_VAR

END_FUNCTION_BLOCK

METHOD GetCount : INT
GetCount := iCount;
END_METHOD
`,
	},

	{
		name: "interface_with_property",
		pouName: "ITF_LANG_with_property",
		kind: "interface",
		feature: "INTERFACE with a PROPERTY declaration — property branch in find-identifier",
		fromDoc: "10-keywords.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_iwp : FB_LANG_with_property_impl;\n\tiPv : INT;",
		plcPrgBody: "iPv := fb_iwp.Value;",
		source:
`INTERFACE ITF_LANG_with_property

PROPERTY Value : INT
END_PROPERTY

END_INTERFACE
`,
	},

	{
		name: "interface_with_property_impl",
		pouName: "FB_LANG_with_property_impl",
		kind: "function_block",
		feature: "FB implementing an interface property (GET-only) — TC rejects because property accessors require both GET and SET when the interface contract is symmetric",
		fromDoc: "10-keywords.md",
		expectTcAccepts: false,
		note: "DISCOVERY (verified live 2026-05-30): TC errors with 'no implementation for method __SETVALUE defined in interface' even when only GET is needed by the consumer. A complete property impl must define both GET and SET — covered by the existing `oop_property_get_set` tests elsewhere. Catalog entry kept as a known-quirk record.",
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`FUNCTION_BLOCK FB_LANG_with_property_impl IMPLEMENTS ITF_LANG_with_property
VAR
	iValueBacking : INT := 11;
END_VAR

END_FUNCTION_BLOCK

PROPERTY Value : INT
GET
Value := iValueBacking;
END_GET
END_PROPERTY
`,
	},
];
