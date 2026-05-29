/**
 * Pragma conformance test catalog.
 *
 * Each entry is a small, self-contained TwinCAT-pushable POU that
 * exercises ONE documented pragma. Used by:
 *   - `language.test.ts` — replays committed TC ground truth, runs
 *     LSP diagnostics on each `source`, compares the two sides
 *   - `record-language.ts` (CLI) — pushes each `source` to a live
 *     TwinCAT project, runs `volt build`, records the resulting TC
 *     diagnostics into `expected-tc.json`
 *
 * Catalog principles:
 * - Self-contained: every test is a single FB / GVL with the
 *   prefix `FB_LANG_` / `GVL_LANG_` (cleanup-friendly).
 * - One pragma per test: keeps disagreement attribution unambiguous.
 * - Mix of POSITIVE (`expectTcAccepts: true`) and NEGATIVE
 *   (`expectTcAccepts: false`) — both LSP false-positive and
 *   LSP-missed bugs need coverage.
 * - `fromDoc` points at the section of the reference doc the test
 *   came from, so a doc edit (rule clarification) can be traced
 *   to the test cases that need updating.
 */

export interface LanguageTest {
	/** Unique slug; identifies the test in reports and the expected-tc.json map. */
	name: string;
	/** TwinCAT POU name as it appears in the project tree. Must start with `LANG_` prefix-aware identifier (FB_LANG_*, GVL_LANG_*, DUT_LANG_*) for cleanup. */
	pouName: string;
	/** Item kind on the bridge — picks the workspace extension (.st / .gvl / .dut). */
	kind: "function_block" | "function" | "program" | "gvl" | "structure" | "interface";
	/** What the test exercises — short label for reports. */
	feature: string;
	/** Self-contained workspace file content (matches the .st-assemble shape). */
	source: string;
	/** Anchor in the reference doc. Format: `<filename>#<section>` or `<filename>:L<line>`. */
	fromDoc: string;
	/** Whether TwinCAT is expected to accept this code (no errors). */
	expectTcAccepts: boolean;
	/**
	 * VAR section snippet for PLC_PRG (e.g. `"fb : FB_LANG_hide_var;"`).
	 * TwinCAT only analyzes code reachable from the program entry point —
	 * without an instantiation in PLC_PRG, the test POU is dead code and
	 * the compiler doesn't generate diagnostics for it. Required for
	 * function_block / function tests.
	 */
	plcPrgVar?: string;
	/** PLC_PRG body snippet — e.g. `"fb();"` — that exercises the instantiation. */
	plcPrgBody?: string;
	/** Optional human note explaining why we expect what we expect. */
	note?: string;
}

export const PRAGMA_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: 07-pragmas.md — attribute pragmas + message pragmas
	// ========================================================================

	// NOTE: GVL push is currently a known limitation in volt-agent's
	// st-parse (architecture: GVLs are vendor-controlled, pull-only).
	// GVL-specific pragma tests (qualified_only, etc.) are tracked
	// separately — they need a bridge-direct push path or a lift of
	// the parseFile restriction. Catalog below covers FB pragmas only.

	{
		name: "hide_var",
		pouName: "FB_LANG_hide_var",
		kind: "function_block",
		feature: "{attribute 'hide'} on a variable hides it from online monitoring",
		fromDoc: "07-pragmas.md#hide",
		expectTcAccepts: true,
		plcPrgVar: "fb_hide : FB_LANG_hide_var;",
		plcPrgBody: "fb_hide.iSecret := 1;\nfb_hide.iVisible := 2;",
		source:
`FUNCTION_BLOCK FB_LANG_hide_var
VAR
	{attribute 'hide'}
	iSecret : INT;
	iVisible : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "call_after_init",
		pouName: "FB_LANG_call_after_init",
		kind: "function_block",
		feature: "{attribute 'call_after_init'} on a method runs after FB instantiation",
		fromDoc: "07-pragmas.md#call_after_init",
		expectTcAccepts: true,
		plcPrgVar: "fb_cai : FB_LANG_call_after_init;",
		plcPrgBody: "fb_cai();",
		source:
`FUNCTION_BLOCK FB_LANG_call_after_init
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_after_init'}
METHOD AfterInit
VAR_INPUT
END_VAR
iCounter := 1;
END_METHOD
`,
	},

	// ─── Positive: message pragmas TC accepts ─────────────────────────

	{
		name: "warning_message",
		pouName: "FB_LANG_warning_message",
		kind: "function_block",
		feature: "{warning 'msg'} pragma emits a TC warning (C0373), not an error",
		fromDoc: "07-pragmas.md#message-pragmas",
		expectTcAccepts: true,
		plcPrgVar: "fb_warn : FB_LANG_warning_message;",
		plcPrgBody: "fb_warn();",
		note: "TC should accept (build succeeds) but emit a warning diagnostic.",
		source:
`FUNCTION_BLOCK FB_LANG_warning_message
VAR
	iVar : INT;
END_VAR
{warning 'this is a deliberate test warning'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
	},

	// ─── More variable-level attributes ──────────────────────────────

	{
		name: "noinit",
		pouName: "FB_LANG_noinit",
		kind: "function_block",
		feature: "{attribute 'noinit'} skips implicit zero-init for a variable",
		fromDoc: "07-pragmas.md#noinit",
		expectTcAccepts: true,
		plcPrgVar: "fb_noinit : FB_LANG_noinit;",
		plcPrgBody: "fb_noinit.iRetain := fb_noinit.iRetain + 1;",
		source:
`FUNCTION_BLOCK FB_LANG_noinit
VAR
	{attribute 'noinit'}
	iRetain : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "init_on_onlchange",
		pouName: "FB_LANG_init_on_onlchange",
		kind: "function_block",
		feature: "{attribute 'init_on_onlchange'} re-inits a var on every online change",
		fromDoc: "07-pragmas.md#init_on_onlchange",
		expectTcAccepts: true,
		plcPrgVar: "fb_ioc : FB_LANG_init_on_onlchange;",
		plcPrgBody: "fb_ioc.iVar := 1;",
		source:
`FUNCTION_BLOCK FB_LANG_init_on_onlchange
VAR
	{attribute 'init_on_onlchange'}
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "displaymode_hex",
		pouName: "FB_LANG_displaymode_hex",
		kind: "function_block",
		feature: "{attribute 'displaymode' := 'hex'} overrides monitor format",
		fromDoc: "07-pragmas.md#displaymode",
		expectTcAccepts: true,
		plcPrgVar: "fb_dm : FB_LANG_displaymode_hex;",
		plcPrgBody: "fb_dm.iHex := 16#FF;",
		source:
`FUNCTION_BLOCK FB_LANG_displaymode_hex
VAR
	{attribute 'displaymode' := 'hex'}
	iHex : DWORD;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "no_copy",
		pouName: "FB_LANG_no_copy",
		kind: "function_block",
		feature: "{attribute 'no_copy'} prevents the var from being copied during online change",
		fromDoc: "07-pragmas.md#no_copy",
		expectTcAccepts: true,
		plcPrgVar: "fb_nc : FB_LANG_no_copy;",
		plcPrgBody: "fb_nc.iLocal := 42;",
		source:
`FUNCTION_BLOCK FB_LANG_no_copy
VAR
	{attribute 'no_copy'}
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── POU-level attributes ────────────────────────────────────────

	{
		name: "linkalways",
		pouName: "FB_LANG_linkalways",
		kind: "function_block",
		feature: "{attribute 'linkalways'} forces the POU to be linked even if uncalled",
		fromDoc: "07-pragmas.md#linkalways",
		expectTcAccepts: true,
		plcPrgVar: "fb_la : FB_LANG_linkalways;",
		plcPrgBody: "fb_la();",
		source:
`{attribute 'linkalways'}
FUNCTION_BLOCK FB_LANG_linkalways
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "no_check",
		pouName: "FB_LANG_no_check",
		kind: "function_block",
		feature: "{attribute 'no_check'} suppresses implicit-check function calls",
		fromDoc: "07-pragmas.md#no_check",
		expectTcAccepts: true,
		plcPrgVar: "fb_nck : FB_LANG_no_check;",
		plcPrgBody: "fb_nck();",
		source:
`{attribute 'no_check'}
FUNCTION_BLOCK FB_LANG_no_check
VAR
	arr : ARRAY[0..10] OF INT;
	i : INT := 0;
END_VAR
arr[i] := 1;
END_FUNCTION_BLOCK
`,
	},

	{
		name: "no_instance_in_retain",
		pouName: "FB_LANG_no_instance_in_retain",
		kind: "function_block",
		feature: "{attribute 'no_instance_in_retain'} forbids the FB as a RETAIN variable",
		fromDoc: "07-pragmas.md#no_instance_in_retain",
		expectTcAccepts: true,
		plcPrgVar: "fb_nir : FB_LANG_no_instance_in_retain;",
		plcPrgBody: "fb_nir();",
		source:
`{attribute 'no_instance_in_retain'}
FUNCTION_BLOCK FB_LANG_no_instance_in_retain
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "hide_all_locals",
		pouName: "FB_LANG_hide_all_locals",
		kind: "function_block",
		feature: "{attribute 'hide_all_locals'} hides all local vars from CODESYS UI",
		fromDoc: "07-pragmas.md#hide_all_locals",
		expectTcAccepts: true,
		plcPrgVar: "fb_hal : FB_LANG_hide_all_locals;",
		plcPrgBody: "fb_hal();",
		source:
`{attribute 'hide_all_locals'}
FUNCTION_BLOCK FB_LANG_hide_all_locals
VAR
	iLocal1 : INT;
	iLocal2 : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "no_assign",
		pouName: "FB_LANG_no_assign",
		kind: "function_block",
		feature: "{attribute 'no_assign'} errors on FB instance-to-instance assignment",
		fromDoc: "07-pragmas.md#no_assign",
		expectTcAccepts: true,
		note: "POSITIVE case: declaring the attribute on the FB is fine. A separate test that actually attempts inst1 := inst2 would trigger the error case.",
		plcPrgVar: "fb_na : FB_LANG_no_assign;",
		plcPrgBody: "fb_na();",
		source:
`{attribute 'no_assign'}
FUNCTION_BLOCK FB_LANG_no_assign
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "reflection",
		pouName: "FB_LANG_reflection",
		kind: "function_block",
		feature: "{attribute 'reflection'} marks the FB for compile-time attribute scan",
		fromDoc: "07-pragmas.md#reflection",
		expectTcAccepts: true,
		plcPrgVar: "fb_refl : FB_LANG_reflection;",
		plcPrgBody: "fb_refl();",
		source:
`{attribute 'reflection'}
FUNCTION_BLOCK FB_LANG_reflection
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── Negative-shaped: typo / unknown attribute ────────────────────
	// TC tolerates unknown attributes silently (per docs: unknown
	// attributes are ignored, not errors). LSP should flag them as a
	// `unknownPragma` warning. Disagreement here is EXPECTED and a
	// feature, not a bug — proves the LSP catches things TC ignores.

	{
		name: "unknown_attribute_typo",
		pouName: "FB_LANG_unknown_attribute_typo",
		kind: "function_block",
		feature: "Typo in attribute name — TC ignores, LSP should warn",
		fromDoc: "07-pragmas.md#attribute-pragma-catalog",
		expectTcAccepts: true,
		plcPrgVar: "fb_unk : FB_LANG_unknown_attribute_typo;",
		plcPrgBody: "fb_unk.iX := 1;",
		note: "TC silently ignores unknown attributes; LSP `unknownPragma` warning is the value-add.",
		source:
`FUNCTION_BLOCK FB_LANG_unknown_attribute_typo
VAR
	{attribute 'qualifid_only'}
	iX : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── More variable + POU attributes (batch 2) ────────────────────

	{
		name: "enable_dynamic_creation",
		pouName: "FB_LANG_enable_dynamic_creation",
		kind: "function_block",
		feature: "{attribute 'enable_dynamic_creation'} required for __NEW operator on FB",
		fromDoc: "07-pragmas.md#enable_dynamic_creation",
		expectTcAccepts: true,
		plcPrgVar: "fb_edc : FB_LANG_enable_dynamic_creation;",
		plcPrgBody: "fb_edc();",
		source:
`{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK FB_LANG_enable_dynamic_creation
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "const_replaced",
		pouName: "FB_LANG_const_replaced",
		kind: "function_block",
		feature: "{attribute 'const_replaced'} forces a constant to be inlined",
		fromDoc: "07-pragmas.md#const_replaced--const_non_replaced",
		expectTcAccepts: true,
		plcPrgVar: "fb_cr : FB_LANG_const_replaced;",
		plcPrgBody: "fb_cr();",
		source:
`FUNCTION_BLOCK FB_LANG_const_replaced
VAR CONSTANT
	{attribute 'const_replaced'}
	C_MAX : INT := 100;
END_VAR
VAR
	iLocal : INT;
END_VAR
iLocal := C_MAX;
END_FUNCTION_BLOCK
`,
	},

	{
		name: "const_non_replaced",
		pouName: "FB_LANG_const_non_replaced",
		kind: "function_block",
		feature: "{attribute 'const_non_replaced'} keeps a constant as a symbol",
		fromDoc: "07-pragmas.md#const_replaced--const_non_replaced",
		expectTcAccepts: true,
		plcPrgVar: "fb_cnr : FB_LANG_const_non_replaced;",
		plcPrgBody: "fb_cnr();",
		source:
`FUNCTION_BLOCK FB_LANG_const_non_replaced
VAR CONSTANT
	{attribute 'const_non_replaced'}
	C_LIMIT : INT := 200;
END_VAR
VAR
	iLocal : INT;
END_VAR
iLocal := C_LIMIT;
END_FUNCTION_BLOCK
`,
	},

	{
		name: "global_init_slot",
		pouName: "FB_LANG_global_init_slot",
		kind: "function_block",
		feature: "{attribute 'global_init_slot' := '49000'} overrides init order",
		fromDoc: "07-pragmas.md#global_init_slot",
		expectTcAccepts: true,
		plcPrgVar: "fb_gis : FB_LANG_global_init_slot;",
		plcPrgBody: "fb_gis();",
		source:
`{attribute 'global_init_slot' := '49000'}
FUNCTION_BLOCK FB_LANG_global_init_slot
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "monitoring_display",
		pouName: "FB_LANG_monitoring_display",
		kind: "function_block",
		feature: "{attribute 'monitoring_display' := '<member>'} shows member in monitor",
		fromDoc: "07-pragmas.md#monitoring_display",
		expectTcAccepts: true,
		plcPrgVar: "fb_md : FB_LANG_monitoring_display;",
		plcPrgBody: "fb_md.iStatus := 1;",
		source:
`{attribute 'monitoring_display' := 'iStatus'}
FUNCTION_BLOCK FB_LANG_monitoring_display
VAR
	iStatus : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "monitoring_encoding",
		pouName: "FB_LANG_monitoring_encoding",
		kind: "function_block",
		feature: "{attribute 'monitoring_encoding' := 'UTF8'} marks a STRING as UTF-8",
		fromDoc: "07-pragmas.md#monitoring_encoding",
		expectTcAccepts: true,
		plcPrgVar: "fb_me : FB_LANG_monitoring_encoding;",
		plcPrgBody: "fb_me.sValue := 'hello';",
		source:
`FUNCTION_BLOCK FB_LANG_monitoring_encoding
VAR
	{attribute 'monitoring_encoding' := 'UTF8'}
	sValue : STRING;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "subsequent",
		pouName: "FB_LANG_subsequent",
		kind: "function_block",
		feature: "{attribute 'subsequent'} allocates VAR section contiguously",
		fromDoc: "07-pragmas.md#subsequent",
		expectTcAccepts: true,
		plcPrgVar: "fb_sub : FB_LANG_subsequent;",
		plcPrgBody: "fb_sub.iA := 1; fb_sub.iB := 2;",
		source:
`FUNCTION_BLOCK FB_LANG_subsequent
{attribute 'subsequent'}
VAR
	iA : INT;
	iB : INT;
	iC : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "suppress_warning",
		pouName: "FB_LANG_suppress_warning",
		kind: "function_block",
		feature: "{attribute 'suppress_warning' := '<id>'} hides specific TC warnings within the POU",
		fromDoc: "07-pragmas.md#suppress_warning",
		expectTcAccepts: true,
		plcPrgVar: "fb_sw : FB_LANG_suppress_warning;",
		plcPrgBody: "fb_sw();",
		source:
`{attribute 'suppress_warning' := '0125'}
FUNCTION_BLOCK FB_LANG_suppress_warning
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "conditionalshow",
		pouName: "FB_LANG_conditionalshow",
		kind: "function_block",
		feature: "{attribute 'conditionalshow' := '<text>'} hides identifiers conditionally",
		fromDoc: "07-pragmas.md#conditionalshow",
		expectTcAccepts: true,
		plcPrgVar: "fb_cs : FB_LANG_conditionalshow;",
		plcPrgBody: "fb_cs.iHidden := 1;",
		source:
`FUNCTION_BLOCK FB_LANG_conditionalshow
VAR
	{attribute 'conditionalshow' := 'maintainer_only'}
	iHidden : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "pingroup",
		pouName: "FB_LANG_pingroup",
		kind: "function_block",
		feature: "{attribute 'pingroup' := '<name>'} groups FB pins in graphical editors",
		fromDoc: "07-pragmas.md#pingroup",
		expectTcAccepts: true,
		plcPrgVar: "fb_pg : FB_LANG_pingroup;",
		plcPrgBody: "fb_pg(iInputA := 1, iInputB := 2);",
		source:
`FUNCTION_BLOCK FB_LANG_pingroup
VAR_INPUT
	{attribute 'pingroup' := 'control'}
	iInputA : INT;
	{attribute 'pingroup' := 'control'}
	iInputB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── Additional message pragmas: positive emission cases ──────────

	{
		name: "info_message",
		pouName: "FB_LANG_info_message",
		kind: "function_block",
		feature: "{info 'msg'} emits a TC informational message (filterable)",
		fromDoc: "07-pragmas.md#message-pragmas",
		expectTcAccepts: true,
		plcPrgVar: "fb_info : FB_LANG_info_message;",
		plcPrgBody: "fb_info();",
		note: "TC should accept and emit an info-level diagnostic.",
		source:
`FUNCTION_BLOCK FB_LANG_info_message
VAR
	iVar : INT;
END_VAR
{info 'this is a deliberate test info'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
	},

	{
		name: "text_message",
		pouName: "FB_LANG_text_message",
		kind: "function_block",
		feature: "{text 'msg'} emits a TC plain-text message (no severity)",
		fromDoc: "07-pragmas.md#message-pragmas",
		expectTcAccepts: true,
		plcPrgVar: "fb_text : FB_LANG_text_message;",
		plcPrgBody: "fb_text();",
		source:
`FUNCTION_BLOCK FB_LANG_text_message
VAR
	iVar : INT;
END_VAR
{text 'this is a deliberate test text'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
	},

	// ─── More variable + POU attributes (batch 3) ────────────────────

	{
		name: "instance_path_with_reflection",
		pouName: "FB_LANG_instance_path_with_reflection",
		kind: "function_block",
		feature: "{attribute 'instance-path'} STRING var inside a {attribute 'reflection'} FB",
		fromDoc: "07-pragmas.md#instance-path",
		expectTcAccepts: true,
		note: "Compound attribute setup: instance-path requires reflection on the FB + noinit on the STRING.",
		plcPrgVar: "fb_ipr : FB_LANG_instance_path_with_reflection;",
		plcPrgBody: "fb_ipr();",
		source:
`{attribute 'reflection'}
FUNCTION_BLOCK FB_LANG_instance_path_with_reflection
VAR
	{attribute 'instance-path'}
	{attribute 'noinit'}
	sMyPath : STRING(255);
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "displaymode_bin",
		pouName: "FB_LANG_displaymode_bin",
		kind: "function_block",
		feature: "{attribute 'displaymode' := 'bin'} variant value",
		fromDoc: "07-pragmas.md#displaymode",
		expectTcAccepts: true,
		plcPrgVar: "fb_dmb : FB_LANG_displaymode_bin;",
		plcPrgBody: "fb_dmb.iBits := 2#1010;",
		source:
`FUNCTION_BLOCK FB_LANG_displaymode_bin
VAR
	{attribute 'displaymode' := 'bin'}
	iBits : BYTE;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "displaymode_dec",
		pouName: "FB_LANG_displaymode_dec",
		kind: "function_block",
		feature: "{attribute 'displaymode' := 'dec'} variant value (the default, made explicit)",
		fromDoc: "07-pragmas.md#displaymode",
		expectTcAccepts: true,
		plcPrgVar: "fb_dmd : FB_LANG_displaymode_dec;",
		plcPrgBody: "fb_dmd.iDec := 42;",
		source:
`FUNCTION_BLOCK FB_LANG_displaymode_dec
VAR
	{attribute 'displaymode' := 'dec'}
	iDec : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "displaymode_invalid_value",
		pouName: "FB_LANG_displaymode_invalid_value",
		kind: "function_block",
		feature: "{attribute 'displaymode' := 'xyz'} invalid value — should warn",
		fromDoc: "07-pragmas.md#displaymode",
		expectTcAccepts: true,
		note: "Only valid values are bin/binary/dec/decimal/hex/hexadecimal. TC may silently ignore; LSP could validate the value enum.",
		plcPrgVar: "fb_dmi : FB_LANG_displaymode_invalid_value;",
		plcPrgBody: "fb_dmi.iVal := 1;",
		source:
`FUNCTION_BLOCK FB_LANG_displaymode_invalid_value
VAR
	{attribute 'displaymode' := 'xyz'}
	iVal : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "suppress_warning_multi",
		pouName: "FB_LANG_suppress_warning_multi",
		kind: "function_block",
		feature: "{attribute 'suppress_warning' := '<id1>','<id2>'} with multiple warning IDs",
		fromDoc: "07-pragmas.md#suppress_warning",
		expectTcAccepts: true,
		plcPrgVar: "fb_swm : FB_LANG_suppress_warning_multi;",
		plcPrgBody: "fb_swm();",
		source:
`{attribute 'suppress_warning' := '0125','0033'}
FUNCTION_BLOCK FB_LANG_suppress_warning_multi
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "no_init_aliases",
		pouName: "FB_LANG_no_init_aliases",
		kind: "function_block",
		feature: "noinit / no_init / no-init — all three alias forms",
		fromDoc: "07-pragmas.md#noinit",
		expectTcAccepts: true,
		note: "Per docs, three spellings of the same attribute. TC + LSP must accept all three identically.",
		plcPrgVar: "fb_nia : FB_LANG_no_init_aliases;",
		plcPrgBody: "fb_nia.iA := fb_nia.iA + 1;",
		source:
`FUNCTION_BLOCK FB_LANG_no_init_aliases
VAR
	{attribute 'noinit'}
	iA : INT;
	{attribute 'no_init'}
	iB : INT;
	{attribute 'no-init'}
	iC : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "linkalways_with_unused_pou",
		pouName: "FB_LANG_linkalways_with_unused_pou",
		kind: "function_block",
		feature: "{attribute 'linkalways'} on an FB that PLC_PRG doesn't call",
		fromDoc: "07-pragmas.md#linkalways",
		expectTcAccepts: true,
		note: "The whole point of linkalways: force compile even when uncalled. PLC_PRG entry intentionally absent.",
		plcPrgVar: undefined,
		plcPrgBody: undefined,
		source:
`{attribute 'linkalways'}
FUNCTION_BLOCK FB_LANG_linkalways_with_unused_pou
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── More attribute pragmas (batch 4) ───────────────────────────

	{
		name: "conditionalshow_all_locals",
		pouName: "FB_LANG_conditionalshow_all_locals",
		kind: "function_block",
		feature: "{attribute 'conditionalshow_all_locals' := '<text>'} — FB-level locals hide",
		fromDoc: "07-pragmas.md#conditionalshow_all_locals",
		expectTcAccepts: true,
		plcPrgVar: "fb_csal : FB_LANG_conditionalshow_all_locals;",
		plcPrgBody: "fb_csal();",
		source:
`{attribute 'conditionalshow_all_locals' := 'maintainer_only'}
FUNCTION_BLOCK FB_LANG_conditionalshow_all_locals
VAR
	iA : INT;
	iB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "pin_presentation_order",
		pouName: "FB_LANG_pin_presentation_order",
		kind: "function_block",
		feature: "{attribute 'pin_presentation_order_inputs' := '...'} reorders FBD/LD pins",
		fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
		expectTcAccepts: true,
		plcPrgVar: "fb_ppo : FB_LANG_pin_presentation_order;",
		plcPrgBody: "fb_ppo(iB := 1, iA := 2);",
		source:
`{attribute 'pin_presentation_order_inputs' := 'iB,iA'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order
VAR_INPUT
	iA : INT;
	iB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "estimated_stack_usage",
		pouName: "FB_LANG_estimated_stack_usage",
		kind: "function_block",
		feature: "{attribute 'estimated-stack-usage' := '<bytes>'} on a recursive method",
		fromDoc: "07-pragmas.md#estimated-stack-usage",
		expectTcAccepts: true,
		plcPrgVar: "fb_esu : FB_LANG_estimated_stack_usage;",
		plcPrgBody: "fb_esu.Recurse(iN := 5);",
		source:
`FUNCTION_BLOCK FB_LANG_estimated_stack_usage
VAR
	iResult : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'estimated-stack-usage' := '128'}
METHOD Recurse
VAR_INPUT
	iN : INT;
END_VAR
iResult := iN;
END_METHOD
`,
	},

	{
		name: "no_virtual_actions",
		pouName: "FB_LANG_no_virtual_actions",
		kind: "function_block",
		feature: "{attribute 'no_virtual_actions'} prevents SFC action overrides in subclasses",
		fromDoc: "07-pragmas.md#no_virtual_actions",
		expectTcAccepts: true,
		plcPrgVar: "fb_nva : FB_LANG_no_virtual_actions;",
		plcPrgBody: "fb_nva();",
		source:
`{attribute 'no_virtual_actions'}
FUNCTION_BLOCK FB_LANG_no_virtual_actions
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "io_function_block",
		pouName: "FB_LANG_io_function_block",
		kind: "function_block",
		feature: "{attribute 'io_function_block'} marks FB as I/O-channel eligible",
		fromDoc: "07-pragmas.md#io_function_block-io_function_block_mapping",
		expectTcAccepts: true,
		plcPrgVar: "fb_iofb : FB_LANG_io_function_block;",
		plcPrgBody: "fb_iofb();",
		source:
`{attribute 'io_function_block'}
FUNCTION_BLOCK FB_LANG_io_function_block
VAR_INPUT
	{attribute 'io_function_block_mapping'}
	iChannel : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "call_after_global_init_slot",
		pouName: "FB_LANG_call_after_global_init_slot",
		kind: "function_block",
		feature: "{attribute 'call_after_global_init_slot' := '<slot>'} on a method",
		fromDoc: "07-pragmas.md#call_after_global_init_slot",
		expectTcAccepts: true,
		plcPrgVar: "fb_cagis : FB_LANG_call_after_global_init_slot;",
		plcPrgBody: "fb_cagis();",
		source:
`FUNCTION_BLOCK FB_LANG_call_after_global_init_slot
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
iCount := 1;
END_METHOD
`,
	},

	{
		name: "warning_disable_restore",
		pouName: "FB_LANG_warning_disable_restore",
		kind: "function_block",
		feature: "{warning disable <id>} / {warning restore <id>} pair around a code block",
		fromDoc: "07-pragmas.md#warning-disable-warning-restore",
		expectTcAccepts: true,
		plcPrgVar: "fb_wdr : FB_LANG_warning_disable_restore;",
		plcPrgBody: "fb_wdr();",
		source:
`FUNCTION_BLOCK FB_LANG_warning_disable_restore
VAR
	iVar : INT;
END_VAR
{warning disable C0125}
iVar := iVar + 1;
{warning restore C0125}
END_FUNCTION_BLOCK
`,
	},

	// ─── More attribute pragmas (batch 5) ───────────────────────────

	{
		name: "call_after_online_change_slot",
		pouName: "FB_LANG_call_after_online_change_slot",
		kind: "function_block",
		feature: "{attribute 'call_after_online_change_slot' := '<slot>'} on a function",
		fromDoc: "07-pragmas.md#call_after_online_change_slot",
		expectTcAccepts: true,
		plcPrgVar: "fb_caocs : FB_LANG_call_after_online_change_slot;",
		plcPrgBody: "fb_caocs();",
		source:
`FUNCTION_BLOCK FB_LANG_call_after_online_change_slot
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_after_online_change_slot' := '50000'}
METHOD AfterOnlineChange
iCount := 1;
END_METHOD
`,
	},

	{
		name: "call_before_global_exit_slot",
		pouName: "FB_LANG_call_before_global_exit_slot",
		kind: "function_block",
		feature: "{attribute 'call_before_global_exit_slot' := '<slot>'} on a function",
		fromDoc: "07-pragmas.md#call_before_global_exit_slot",
		expectTcAccepts: true,
		plcPrgVar: "fb_cbges : FB_LANG_call_before_global_exit_slot;",
		plcPrgBody: "fb_cbges();",
		source:
`FUNCTION_BLOCK FB_LANG_call_before_global_exit_slot
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_before_global_exit_slot' := '50000'}
METHOD BeforeGlobalExit
iCleanup := 0;
END_METHOD
`,
	},

	{
		name: "call_on_type_change",
		pouName: "FB_LANG_call_on_type_change",
		kind: "function_block",
		feature: "{attribute 'call_on_type_change' := '<fb>'} on a method tracking referenced FB type",
		fromDoc: "07-pragmas.md#call_on_type_change",
		expectTcAccepts: true,
		plcPrgVar: "fb_cotc : FB_LANG_call_on_type_change;",
		plcPrgBody: "fb_cotc();",
		source:
`FUNCTION_BLOCK FB_LANG_call_on_type_change
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_on_type_change' := 'FB_LANG_call_on_type_change'}
METHOD ReactToTypeChange : INT
iVar := 1;
ReactToTypeChange := iVar;
END_METHOD
`,
	},

	{
		name: "pin_presentation_order_outputs",
		pouName: "FB_LANG_pin_presentation_order_outputs",
		kind: "function_block",
		feature: "{attribute 'pin_presentation_order_outputs' := '...'} reorders FB output pins",
		fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
		expectTcAccepts: true,
		plcPrgVar: "fb_ppoo : FB_LANG_pin_presentation_order_outputs;",
		plcPrgBody: "fb_ppoo();",
		source:
`{attribute 'pin_presentation_order_outputs' := 'oResult,oStatus'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order_outputs
VAR_OUTPUT
	oStatus : INT;
	oResult : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "pin_presentation_order_wildcard",
		pouName: "FB_LANG_pin_presentation_order_wildcard",
		kind: "function_block",
		feature: "{attribute 'pin_presentation_order_inputs'} with `*` placeholder for unspecified",
		fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
		expectTcAccepts: true,
		plcPrgVar: "fb_ppow : FB_LANG_pin_presentation_order_wildcard;",
		plcPrgBody: "fb_ppow();",
		source:
`{attribute 'pin_presentation_order_inputs' := 'iLast,*'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order_wildcard
VAR_INPUT
	iA : INT;
	iB : INT;
	iLast : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "implicit_parameter_pouname",
		pouName: "FB_LANG_implicit_parameter_pouname",
		kind: "function_block",
		feature: "{attribute 'implicit-parameter' := 'pouname'} on a VAR_INPUT STRING",
		fromDoc: "07-pragmas.md#implicit-parameter",
		expectTcAccepts: true,
		plcPrgVar: "fb_ipp : FB_LANG_implicit_parameter_pouname;",
		plcPrgBody: "fb_ipp.LogIt();",
		source:
`FUNCTION_BLOCK FB_LANG_implicit_parameter_pouname
VAR
	sLastCaller : STRING(255);
END_VAR

END_FUNCTION_BLOCK

METHOD LogIt
VAR_INPUT
	{attribute 'implicit-parameter' := 'pouname'}
	sCaller : STRING(255);
END_VAR
sLastCaller := sCaller;
END_METHOD
`,
	},

	// NOTE: `is_connected_with_reflection` and `monitoring_on_property`
	// removed for v1 — both hit "Child update missing 'declaration' field"
	// in the push pipeline. The first mixes VAR_INPUT + VAR in a way the
	// parser treats specially; the second is a property with only GET
	// (no SET), which st-parse needs both for. Add when those parser
	// limitations are lifted.

	// ─── Region pragma — folding-only, no semantic effect ─────────────

	{
		name: "region_basic",
		pouName: "FB_LANG_region_basic",
		kind: "function_block",
		feature: "{region 'name'} / {end_region} pair — source folding only",
		fromDoc: "07-pragmas.md#region-pragma",
		expectTcAccepts: true,
		plcPrgVar: "fb_rb : FB_LANG_region_basic;",
		plcPrgBody: "fb_rb();",
		source:
`FUNCTION_BLOCK FB_LANG_region_basic
VAR
	{region 'state'}
	iCounter : INT;
	iTotal : INT;
	{end_region}
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// ─── Negative: message pragma {error} should make TC fail build ──

	{
		name: "error_message",
		pouName: "FB_LANG_error_message",
		kind: "function_block",
		feature: "{error 'msg'} pragma should cause TC to fail the build",
		fromDoc: "07-pragmas.md#message-pragmas",
		expectTcAccepts: false,
		plcPrgVar: "fb_err : FB_LANG_error_message;",
		plcPrgBody: "fb_err();",
		note: "Per docs, {error 'msg'} is an explicit compile error. Verify TC emits error AND LSP recognises it.",
		source:
`FUNCTION_BLOCK FB_LANG_error_message
VAR
	iVar : INT;
END_VAR
{error 'this is a deliberate test error'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
	},
];
