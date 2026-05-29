/**
 * Shared types for the language-conformance test catalog.
 *
 * Each per-category file (pragma-tests.ts, lifecycle-tests.ts, …)
 * imports `LanguageTest` from here, so the shape stays in ONE place
 * even when the catalog is sliced across many files.
 */

/**
 * One conformance test entry. The recorder uses it to push the source
 * to TwinCAT + record the compiler's response; the replay test uses
 * it to run the LSP's semantic diagnostics on the same source and
 * compare against the recorded TC outcome.
 */
export interface LanguageTest {
	/** Unique slug; identifies the test in reports and the expected-tc.json map. */
	name: string;
	/** TwinCAT POU name as it appears in the project tree. Must start with a `LANG_`-prefixed identifier (FB_LANG_*, GVL_LANG_*, DUT_LANG_*, ITF_LANG_*) so the recorder's cleanup sweep catches it. */
	pouName: string;
	/** Item kind on the bridge — picks the workspace extension (.st / .gvl / .dut / .itf). */
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
	 * without an instantiation in PLC_PRG, the test POU is dead code
	 * and the compiler doesn't generate diagnostics for it. Required
	 * for function_block / function tests; optional for ones whose
	 * presence alone matters (interface declarations etc.).
	 */
	plcPrgVar?: string;
	/** PLC_PRG body snippet — e.g. `"fb();"` — that exercises the instantiation. */
	plcPrgBody?: string;
	/**
	 * Force per-test isolated recording. Each isolated test gets its
	 * own push + build + cleanup cycle, with no other test POUs in
	 * the project. Use for tests that:
	 *   - produce PARSE errors (TC short-circuits semantic analysis on
	 *     the whole project once any POU has parse errors, so errors
	 *     in OTHER tests get silently dropped from the build pane)
	 *   - produce so many errors that the pane buffer overflows
	 *
	 * Trade-off: each isolated test costs an extra full push+build
	 * cycle (~2-3s) vs amortized over the mega-batch. Default false —
	 * set only when conformance evidence shows the test loses
	 * fidelity in batch mode.
	 */
	recordIsolated?: boolean;
	/** Optional human note explaining why we expect what we expect. */
	note?: string;
}
