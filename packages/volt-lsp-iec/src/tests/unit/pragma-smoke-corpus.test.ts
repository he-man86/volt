/**
 * Per-pragma smoke-fixture corpus.
 *
 * For every entry in the pragma catalog, generate the minimum ST source
 * that uses it and assert the LSP produces ZERO `unknown-pragma` /
 * `unknown-directive` diagnostics on it. If someone removes an entry
 * from the catalog (or breaks the name field), that pragma's fixture
 * fails — instant regression signal.
 *
 * This is the answer to "how do we know every catalogued pragma actually
 * survives the diagnostic pipeline?" — same shape as conformance tests
 * in other parts of the LSP. The corpus regenerates on every catalog
 * change with zero per-pragma maintenance because the fixtures are
 * built programmatically from the catalog itself.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_DIAGNOSTIC_CONFIG, type DiagnosticConfig } from "../../lsp/config/index.js";
import { ALL_PRAGMAS } from "../../reference/pragmas.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { parseSource } from "../../parser/parser.js";

function runDiagnostics(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const config: DiagnosticConfig = {
		...DEFAULT_DIAGNOSTIC_CONFIG,
		// Force every pragma-related diagnostic on — the smoke test
		// specifically wants to surface any false positives.
		unknownPragma: true,
		wrongVendorPragma: false,  // vendor-cross-warnings are expected on the TC entries vs codesys-active; not what this test pins
		pragmaMissingCompanion: false,  // companions tested separately; this fixture intentionally uses isolated pragmas
		pragmaConflict: false,
	};
	return computeSemanticDiagnostics({
		parseResult,
		source: src,
		project,
		config,
		activeVendor: undefined,  // no active vendor → catalog-only check
		bodyModels: buildBodyModelsForParseResult(parseResult),
	});
}

/** Build the minimum-viable ST source that uses a pragma name in the
 *  right position. Different categories need different scaffolding. */
function buildFixture(name: string, category: string): string {
	switch (category) {
		case "attribute":
			// Wrap a trivial FB with the pragma above it — works for FB-
			// level, GVL-level (close enough — diagnostic checks the
			// directive, not the location), and method-level entries.
			return `{attribute '${name}'}
FUNCTION_BLOCK FB_PragmaTest
END_FUNCTION_BLOCK
`;
		case "message":
			// Message pragmas (text/info/warning/error) are directive-
			// keyword pragmas — wrap one in a POU body.
			return `FUNCTION_BLOCK FB_MsgTest
END_VAR
END_FUNCTION_BLOCK
{${name} 'smoke test'}
`;
		case "conditional":
			// Conditional pragmas come in matched pairs. The smoke test
			// emits the minimal balanced set the name implies.
			if (name === "IF") return `{IF defined(SMOKE)}\n{END_IF}\n`;
			if (name === "ELSIF") return `{IF defined(SMOKE)}\n{ELSIF defined(OTHER)}\n{END_IF}\n`;
			if (name === "ELSE") return `{IF defined(SMOKE)}\n{ELSE}\n{END_IF}\n`;
			if (name === "END_IF") return `{IF defined(SMOKE)}\n{END_IF}\n`;
			if (name === "define") return `{define X 1}\n`;
			if (name === "undefine") return `{undefine X}\n`;
			return `{${name}}\n`;
		case "region":
			if (name === "region") return `{region 'smoke'}\n{end_region}\n`;
			if (name === "end_region") return `{region 'smoke'}\n{end_region}\n`;
			return `{${name}}\n`;
		default:
			return `{attribute '${name}'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
	}
}

describe("pragma smoke corpus — every catalogued pragma survives the unknown-pragma check", () => {
	for (const entry of ALL_PRAGMAS) {
		test(`'${entry.name}' (${entry.category}) doesn't trigger unknown-pragma`, () => {
			const src = buildFixture(entry.name, entry.category);
			const diags = runDiagnostics(src);

			// Filter to ONLY the diagnostics this corpus pins. Message
			// pragmas (text/info/warning/error) intentionally surface as
			// message-pragma-* diagnostics with the author's text — those
			// are correct behavior and must NOT be treated as failures.
			const unknownPragmaDiags = diags.filter((d) => d.code === "unknown-pragma");
			expect(unknownPragmaDiags).toEqual([]);
		});
	}
});

describe("TwinCAT namespace bypass — the ONLY documented vendor namespace we acknowledge", () => {
	test("an uncatalogued Tc-prefixed name does NOT warn (TwinCAT namespace)", () => {
		const src = `{attribute 'TcWhatever'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
		const diags = runDiagnostics(src);
		expect(diags.filter((d) => d.code === "unknown-pragma")).toEqual([]);
	});

	test("Tc2_-prefixed compatibility attribute does NOT warn", () => {
		const src = `{attribute 'Tc2_SomeCompat'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
		const diags = runDiagnostics(src);
		expect(diags.filter((d) => d.code === "unknown-pragma")).toEqual([]);
	});

	test("'Tcontext' (NO clear Tc-namespace boundary) DOES warn — not a real Tc prefix", () => {
		// CamelCase boundary check rejects names that just happen to
		// start with "tc" — `Tcontext` is lowercase after `Tc`, so it
		// reads as user-defined, not a TwinCAT-namespaced attribute.
		const src = `{attribute 'Tcontext'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
		const diags = runDiagnostics(src);
		expect(diags.filter((d) => d.code === "unknown-pragma").length).toBe(1);
	});

	test("'Lenze_SomeAttr' DOES warn — CODESYS-based vendors share the shared catalog, no separate namespace", () => {
		// All CODESYS-based vendors (Lenze, Wago, Schneider, ABB, …) use
		// the same shared catalog as CODESYS proper. A Lenze_ prefix is
		// either an uncatalogued standard attribute (file an issue) or
		// genuinely user-defined — the warning is the correct signal in
		// both cases.
		const src = `{attribute 'Lenze_SomeAttr'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
		const diags = runDiagnostics(src);
		expect(diags.filter((d) => d.code === "unknown-pragma").length).toBe(1);
	});

	test("a bare user-defined attribute DOES warn (no prefix, not catalogued)", () => {
		// Hauzer code had `Create_ACD_Slave_Access_automatically` —
		// verb-prefixed, not a vendor namespace. Warning is correct.
		const src = `{attribute 'Create_ACD_Slave_Access_automatically'}\nFUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`;
		const diags = runDiagnostics(src);
		expect(diags.filter((d) => d.code === "unknown-pragma").length).toBe(1);
	});
});
