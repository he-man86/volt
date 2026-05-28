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

export interface PragmaTest {
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

export const PRAGMA_TESTS: readonly PragmaTest[] = [
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
];
