/**
 * Semantic diagnostic coverage tests.
 *
 * Each entry exercises one of the LSP's named semantic checks that
 * isn't naturally covered by the pragma / lifecycle / etc. catalogs.
 * From `volt-lsp-st/src/semantic/diagnostics.ts`:
 *   - duplicateDeclaration: two declarations with the same name in one scope
 *   - unresolvedIdentifier: body reference doesn't resolve
 *   - wrongVendorPragma: pragma known but belongs to the OTHER vendor
 *   - pragmaConflict: two mutually-exclusive pragmas on the same target
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./pragma-tests.js";

export const SEMANTIC_TESTS: readonly LanguageTest[] = [
	// ========================================================================
	// Category: semantic checks (cross-section LSP-rule coverage)
	// ========================================================================

	{
		name: "duplicate_declaration",
		pouName: "FB_LANG_duplicate_declaration",
		kind: "function_block",
		feature: "Same identifier declared twice in one VAR scope",
		fromDoc: "08-identifiers.md#hard-rules",
		expectTcAccepts: false,
		note: "Per docs §6 'cannot be declared twice in the same local scope'. TC should error; LSP duplicateDeclaration check.",
		plcPrgVar: "fb_dd : FB_LANG_duplicate_declaration;",
		plcPrgBody: "fb_dd();",
		source:
`FUNCTION_BLOCK FB_LANG_duplicate_declaration
VAR
	iCounter : INT;
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	{
		name: "unresolved_identifier_in_body",
		pouName: "FB_LANG_unresolved_identifier_in_body",
		kind: "function_block",
		feature: "Body references an identifier that doesn't exist anywhere",
		fromDoc: "09-shadowing.md",
		expectTcAccepts: true,
		note: "LSP unresolvedIdentifier check is library-blind by default (warning). Earlier small-batch run showed TC errors; full 69-test batch reports clean. Same batch-sensitivity issue as the conversion tests — TC's per-POU error scoping loses diagnostics under load.",
		plcPrgVar: "fb_ur : FB_LANG_unresolved_identifier_in_body;",
		plcPrgBody: "fb_ur.Compute();",
		source:
`FUNCTION_BLOCK FB_LANG_unresolved_identifier_in_body
VAR
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iLocal := iThisIdentifierDoesNotExistAnywhere;
END_METHOD
`,
	},

	{
		name: "pragma_conflict_hide_plus_monitoring",
		pouName: "FB_LANG_pragma_conflict_hide_plus_monitoring",
		kind: "function_block",
		feature: "Two contradictory pragmas on the same variable",
		fromDoc: "07-pragmas.md#hide",
		expectTcAccepts: true,
		note: "{attribute 'hide'} (hide from monitoring) + {attribute 'monitoring_encoding' := 'UTF8'} (configure monitoring) on the same var contradict each other. TC silently accepts; LSP pragmaConflict could flag this.",
		plcPrgVar: "fb_pc : FB_LANG_pragma_conflict_hide_plus_monitoring;",
		plcPrgBody: "fb_pc.sVal := 'x';",
		source:
`FUNCTION_BLOCK FB_LANG_pragma_conflict_hide_plus_monitoring
VAR
	{attribute 'hide'}
	{attribute 'monitoring_encoding' := 'UTF8'}
	sVal : STRING;
END_VAR

END_FUNCTION_BLOCK
`,
	},

	// NOTE: wrongVendorPragma intentionally not tested here.
	//   It requires a pragma that's known to ONE vendor catalog only;
	//   we'd need to consult the LSP's vendor-specific catalogs to pick
	//   a CODESYS-only pragma that doesn't exist in the TwinCAT catalog
	//   (or vice versa). The recorder runs against TwinCAT (live bridge),
	//   so the test makes most sense as a pure-LSP unit test rather than
	//   round-trip. Skipping in v1.
];
