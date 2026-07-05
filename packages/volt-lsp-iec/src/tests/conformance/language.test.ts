/**
 * Language conformance: LSP vs recorded IDE ground truth.
 *
 * Runs the LSP's semantic diagnostics on every test in the full
 * conformance catalog (`ALL_TESTS` from `./index.ts`) and compares
 * against PER-VENDOR recordings:
 *
 *   - `expected-tc.json`      — TwinCAT compiler ground truth
 *   - `expected-codesys.json` — CODESYS compiler ground truth
 *
 * Both populated by `bun run record:language` against the matching
 * bridge (`VOLT_BRIDGE_PORT=8555` for TC, `=8556` for CODESYS). The
 * replay test runs pure — no live bridge required.
 *
 * The test runs the corpus TWICE — once per vendor — feeding the
 * LSP its vendor-filtered config (via `resolveConfig`, the same
 * code path production uses). A regression in either vendor's
 * agreement count fails the suite.
 *
 * Failure modes:
 *   - LSP false positive: IDE compiled cleanly, LSP flagged errors
 *   - LSP missed bug:    IDE errored, LSP saw nothing
 *   - Catalog drift:     test added but ground truth not re-recorded
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { resolveConfig, type Vendor } from "../../lsp/config/index.js";
import { ALL_TESTS } from "./fixtures/index.js";

/**
 * Shape of one IDE diagnostic as committed in `expected-*.json`. Mirrors
 * the bridge wire shape that `scripts/record-language.ts` writes — kept
 * local here because the replay test only READS the recorded JSON and never
 * talks to a live bridge, so it needs no dependency on the recorder or the
 * bridge client.
 */
interface RecordedDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	line: number;
	object: string | null;
	section: "decl" | "impl" | null;
}

interface ExpectedRecording {
	recorded: { at: string; bridgeVersion?: string } | null;
	tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>;
}

function loadExpected(filename: string): ExpectedRecording {
	// Recordings are sibling JSON files (not modules — they need a raw
	// filesystem read, not an import). `import.meta.url` resolves to
	// this file's location at runtime, then we walk into `recordings/`.
	const path = join(dirname(fileURLToPath(import.meta.url)), "recordings", filename);
	const raw = JSON.parse(readFileSync(path, "utf-8")) as ExpectedRecording & {
		_doc?: string;
	};
	return { recorded: raw.recorded, tests: raw.tests };
}

const RECORDINGS: ReadonlyArray<{ vendor: Vendor; filename: string }> = [
	{ vendor: "twincat", filename: "expected-tc.json" },
	{ vendor: "codesys", filename: "expected-codesys.json" },
];

/**
 * The divergence ledger — the ONLY opt-out from the test's single rule (the LSP's error+warning message set
 * must be byte-identical to the compiler's). A fixture listed here is not asserted; everything else must match
 * exactly. Each entry needs a documented reason, and is removed the moment the LSP is taught to match.
 *
 * Two dominant reasons (noted inline per entry):
 *   - VERDICT — one side flags where the other is silent (a real LSP≠IDE capability gap: a check the LSP
 *     doesn't have, or an IDE application-config warning that isn't a source-level property).
 *   - PARSE-CASCADE — the IDE chokes on the input and sprays multiple raw parser errors, where the LSP emits
 *     one clean semantic message. Faking a parser's error-spray is neither feasible nor desirable.
 */
const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
	twincat: new Set<string>([
		// TC rejects a GET-only interface-PROPERTY implementation ("no implementation for method
		// '__SETVALUE' defined in interface") — it requires BOTH accessors; CODESYS accepts GET-only.
		// The LSP's missing-interface check verifies property PRESENCE, not per-accessor (GET/SET)
		// completeness against the interface contract. TC-specific quirk (the fixture note records it).
		"interface_with_property_impl",
		// TRUE CS↔TC divergence: CODESYS accepts backtick-escaped identifiers (`` `TYPE` ``); TwinCAT
		// rejects them (`Unknown type` — the whole FB fails to parse). The LSP's parser is lenient (accepts
		// backticks, matching CODESYS), so on a TwinCAT workspace it stays silent where TC's compiler
		// rejects. Making the parser reject valid CODESYS syntax would false-positive on real CS projects.
		"identifier_backtick_keyword_escape",
		// SAME gap as codesys below (both IDEs warn on an empty PROPERTY with no get/set accessor). Deferred
		// on BOTH vendors for the same verified reason: 92 such properties in the pro2193 corpus (all
		// `{attribute 'monitoring'}`) would mass-false-positive offline. Not a TC-specific quirk.
		"interface_with_property",
		"type_codesys_vector",            // CS-only __VECTOR: LSP emits its vendor-only-type message; TC parse-errors.
		"operand_partial_word_in_dword",  // CS-only `.%W`: TC parse-errors; LSP has its own partial-access message.
		// ── PARSE-CASCADE — the IDE sprays multiple raw parser errors; the LSP emits ONE clean semantic message.
		//    Reproducing a parser's spray is neither feasible nor desirable (same class as op_sys_*). ──
		"identifier_double_underscore",
		"identifier_consecutive_underscores",
		"deref_on_array_type",
		"type_deref_non_pointer",
		"var_non_retain",
		"operand_uchar_literal",
		"op_sys_currenttask",
		"op_sys_varinfo",
		"op_sys_try_catch",
		"op_sys_queryinterface",
		// ── other ──
		"unresolved_identifier_in_body",  // severity matches (error); IDE emits a 2-error cascade, LSP one message.
	]),
	codesys: new Set<string>([
		// CODESYS-specific warnings not surfaced by TC. The LSP defaults
		// to TC-grade rules; matching every CODESYS heuristic warning
		// would mean importing CODESYS's analyzer ruleset (out of scope).
		"fb_reinit_with_params",
		// Both IDEs reject these via parse error. Our parser is more
		// lenient on `__`-prefixed system calls — closing this would
		// mean tightening the parser, risking false positives on
		// legitimate uses elsewhere.
		"op_sys_currenttask",
		"op_sys_queryinterface",
		"op_sys_varinfo",
		// CODESYS rejects with a runtime-config diagnostic ("No memory
		// for dynamic object creation defined"). Not a language-level
		// check the LSP can perform — it's about application device
		// configuration, which isn't in the source code.
		"op_sys_new_delete",
		// CODESYS accepts `dword%W1` bit-access syntax; TC parses but
		// rejects. Our parser matches TC. Aligning with CS would mean
		// teaching the parser the CODESYS extension.
		"operand_partial_word_in_dword",
		// CODESYS warns "No VAR_PERSISTENT list is part of the application to
		// ensure the values are stored" — an APPLICATION-CONFIG check (does a
		// PersistentVars object exist in the app?), not a source-level property.
		// The LSP analyzes source, not the application's object tree, so it
		// cannot (and shouldn't) emit this. Same class as op_sys_new_delete.
		"var_persistent",
		// CODESYS warns "The property defines neither a get nor a set accessor"
		// on an interface PROPERTY with no inline GET/SET. Not safely
		// implementable offline: real interfaces declare the SAME shape en masse
		// (92 such properties in the pro2193 corpus, all `{attribute
		// 'monitoring'}`), and we can't verify offline which CODESYS actually
		// warns on vs. the fixture. Enabling it risked mass false positives, so
		// it's deferred until we can verify against a live CODESYS bridge.
		"interface_with_property",
		// CODESYS warns "The attribute 'pingroup' can only be added to variable"
		// — `pingroup` is placed on the FB HEADER, but per doc 07 L612 it belongs
		// on a variable declaration. This is an attribute-TARGET-placement check
		// the LSP doesn't implement (it isn't the pin/pingroup mutual-exclusion
		// the LSP's pragmaConflict models — that's a different, un-grounded pair
		// warning that would false-positive on TwinCAT, which is silent here).
		"pragma_conflicting_pair",
		// ── PARSE-CASCADE (IDE sprays parser errors; LSP emits one semantic message) ──
		"identifier_double_underscore",
		"identifier_consecutive_underscores",
		"deref_on_array_type",
		"type_deref_non_pointer",
		"var_non_retain",
		"operand_uchar_literal",
		"op_sys_try_catch",               // CS: `Identifier 'exc' not defined`; LSP errors with its own wording.
		// ── other ──
		"unresolved_identifier_in_body",
		"unknown_attribute_typo",         // CS emits an EXTRA `attribute … unknown` warning atop the matched error.
		"monitoring_encoding",            // same extra CS-only attribute-lint warning.
	]),
};

// Cross-test scope assembly — for each test, build a project scope that
// contains the test's full parse result + every OTHER test's declaration-
// only units (interfaces, DUTs, GVLs). Lets `IMPLEMENTS <X>` resolve
// across test files without leaking FBs/methods that would collide on
// common names. Computed ONCE, reused across both vendor runs.
// URI basename is the ITEM name (`pouName`), matching production: on disk a GVL/FB lives in a file named
// after the item, and name-derived-from-file resolution (a GVL's name via `gvlNameFromUri`, so
// `GVL_Name.field` resolves) depends on it. `t.name` is only a test slug. pouNames are unique (asserted).
const ALL_PARSE_RESULTS = ALL_TESTS.map((t) => ({
	uri: `file:///conformance/${t.pouName}.fb` as const,
	parseResult: parseSource(t.source),
}));

const CROSS_TEST_DECLS = ALL_PARSE_RESULTS.map((p) => ({
	uri: p.uri,
	parseResult: {
		units: p.parseResult.units.filter(
			(u) => u.kind === "interface" || u.kind === "type_decl" || u.kind === "global_var_list",
		),
		errors: [],
	},
}));

// The recorder builds each test as {FB + a PLC_PRG that instantiates and uses it} — CODESYS's verdict
// covers the WHOLE build, including the PLC_PRG usage. To keep the LSP side symmetric, synthesize the
// same PLC_PRG (from `plcPrgVar`/`plcPrgBody`) and analyze it too. This is what surfaces usage-only
// diagnostics like external-write (`fb.internalVar := x`), which live in the PLC_PRG body, not the FB.
const PLC_PRGS = ALL_TESTS.map((t) => {
	if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined;
	const source = `PROGRAM PLC_PRG\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody ?? ""}\nEND_PROGRAM\n`;
	return { uri: `file:///conformance/${t.name}__plcprg.fb` as const, source, parseResult: parseSource(source) };
});

function runLsp(
	source: string,
	testIndex: number,
	vendor: Vendor,
): Array<{ severity: string; message: string }> {
	const own = ALL_PARSE_RESULTS[testIndex]!;
	const plc = PLC_PRGS[testIndex];
	const project = buildSymbolTable([
		{ uri: own.uri, parseResult: own.parseResult },
		...(plc ? [{ uri: plc.uri, parseResult: plc.parseResult }] : []),
		...CROSS_TEST_DECLS.filter((_, i) => i !== testIndex),
	]);
	const parseResult = own.parseResult;
	// Run through the same config-resolution code path production uses,
	// so the rule-vendor-applicability filter is applied identically.
	const resolved = resolveConfig({ vendor });
	const diags = computeSemanticDiagnostics({
		parseResult,
		source,
		project,
		config: resolved.diagnostics,
		activeVendor: resolved.vendor,
		bodyModels: buildBodyModelsForParseResult(parseResult),
	});
	// Analyze the synthesized PLC_PRG too (usage-only diagnostics live here — see PLC_PRGS above).
	if (plc) {
		diags.push(
			...computeSemanticDiagnostics({
				parseResult: plc.parseResult,
				source: plc.source,
				project,
				config: resolved.diagnostics,
				activeVendor: resolved.vendor,
				bodyModels: buildBodyModelsForParseResult(plc.parseResult),
			}),
		);
	}
	// Surface parse errors as diagnostics too — comparison wants to know
	// if EITHER side rejected the source.
	for (const e of parseResult.errors) {
		diags.push({
			severity: "error",
			span: e.span,
			source: "volt-lsp-iec-parse",
			code: "parse-error",
			message: e.message,
		});
	}
	return diags.map((d) => ({ severity: d.severity, message: d.message }));
}

for (const { vendor, filename } of RECORDINGS) {
	const expected = loadExpected(filename);
	const hasRecording = expected.recorded !== null;

	describe(`language conformance (LSP vs ${vendor} recording)`, () => {
		if (!hasRecording) {
			it.skip(`(skipped — run \`VOLT_BRIDGE_PORT=${vendor === "twincat" ? "8555" : "8556"} bun run record:language\` to populate ${filename})`, () => {});
			return;
		}

		for (let testIdx = 0; testIdx < ALL_TESTS.length; testIdx++) {
			const test = ALL_TESTS[testIdx]!;
			describe(test.name, () => {
				const recorded = expected.tests[test.name];
				if (recorded === undefined) {
					// Catalog has the test but the bridge recording is
					// stale. Skip gracefully — `bun run record:language`
					// against the matching bridge re-populates entries
					// and flips the skip back to hard assertions.
					it.skip(
						`(no recording in ${filename}; re-record to enable hard checks)`,
						() => {},
					);
					return;
				}

				it("has recorded ground truth", () => {
					expect(expected.tests[test.name]).toBeDefined();
				});

				it(`${vendor} outcome matches catalog expectation`, () => {
					// `expectTcAccepts` is the TC ground truth declared by
					// the catalog author. We use it as the cross-vendor
					// "expected to compile" signal — both vendors should
					// agree on it for tests we expect to be vendor-neutral.
					// Per-vendor divergences are captured in the snapshot.
					if (vendor === "twincat") {
						expect(recorded.buildSuccess).toBe(test.expectTcAccepts);
					}
				});

				it(`LSP diagnostics identical to ${vendor}`, () => {
					// ONE criterion: the LSP's error+warning message SET must be byte-identical to the compiler's.
					// Message identity subsumes presence (equal sets ⇒ both flagged the same code) — that's the
					// whole test. `information`/`hint` severities have no ground truth (the recorder drops CODESYS
					// info noise), so both sides drop them. KNOWN_DIVERGENCES lists every fixture that legitimately
					// does NOT match, each with a documented reason — that set is the entire divergence ledger.
					if (KNOWN_DIVERGENCES[vendor].has(test.name)) return;
					const significant = (sev: string): boolean => sev === "error" || sev === "warning";
					const msgSet = (ds: ReadonlyArray<{ severity: string; message: string }>): string[] =>
						ds.filter((d) => significant(d.severity)).map((d) => `[${d.severity}] ${d.message}`).sort();
					const lspDiags = runLsp(test.source, testIdx, vendor);
					expect(msgSet(lspDiags)).toEqual(msgSet(recorded.diagnostics));
				});
			});
		}
	});
}
