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
 * the bridge wire shape (`BridgeDiagnostic` in volt-agent) — kept local
 * here because the replay test only READS the recorded JSON and never
 * talks to a live bridge. Keeping it local avoids a reverse-direction
 * dependency from volt-lsp-iec back into volt-agent.
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
 * Tests where the LSP and the IDE legitimately disagree on whether
 * to flag the code. The disagreement is real but acceptable — adding
 * an LSP rule to close each gap would require functionality outside
 * the LSP's static-analysis scope. Each entry documents WHY.
 *
 * The hard `lspFlagged === ideFlagged` assertion is skipped for these
 * tests; the diagnostic-detail snapshot still records what each side
 * emits so regressions surface as snapshot diffs.
 *
 * Add an entry only with a documented reason. Remove an entry when
 * the LSP grows the capability to close that gap.
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
	]),
};

// Message-TEXT mirror exceptions. Goal: where the LSP and the IDE both flag the same code, the LSP's message
// should read IDENTICALLY to the compiler's — so an engineer sees the same words in the editor and the IDE.
// The replay ENFORCES that by default (asserts the error+warning message sets are equal); this set lists every
// fixture whose text we do NOT mirror, with the reason. Shrinking this set IS the mirror backlog. Distinct from
// KNOWN_DIVERGENCES (which is about presence — whether the LSP flags at all); an entry here means "flags the
// same, but the words differ on purpose (or not yet)".
const KNOWN_MESSAGE_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
	twincat: new Set<string>([
		// CS≠TC: the two compilers word these differently, so one LSP message can't match both. Left until we
		// decide per-vendor message templates. (Also listed under codesys where its text differs from ours.)
		"fb_init_missing_bInCopyCode",
		"fb_exit_missing_bInCopyCode",
		"identifier_double_underscore",
		"identifier_consecutive_underscores",
		"deref_on_array_type",
		"conditional_orphan_else",
		"op_modulo_on_real",
		"oop_abstract_instantiated",
		"type_var_temp_in_method",
		"type_deref_non_pointer",
		"var_non_retain",
		"operand_uchar_literal",
		// Parse-cascade: the IDE emits raw parser errors (`';' expected instead of …`) from failing to parse a
		// CODESYS-only operator; the LSP emits one clean semantic message. Faking a parser's cascade is neither
		// feasible nor desirable — the plain vendor-only-operator message is the intended mirror of the verdict.
		"op_sys_currenttask",
		"op_sys_varinfo",
		"op_sys_try_catch",
		"op_sys_queryinterface",
		// Severity-gated: IDE emits an error; the LSP emits a warning until the 13 corpus library-blind FPs are
		// driven to 0 (promoting now would ship false-positive errors). Flip when the corpus is clean.
		"unresolved_identifier_in_body",
		// The IDE renders a string LITERAL's source type as `STRING(INT#<len>)` (e.g. `STRING(INT#4)`); our
		// inference yields plain `STRING`, so the type-mismatch text can't match without reproducing CODESYS's
		// length-tagged literal-type rendering. Borderline "within reason" — revisit if we render literal lengths.
		"literal_string_to_int_assignment",
		// Parse-cascade: IDE emits a parse error for the CODESYS-only `__VECTOR` type; the LSP emits its own
		// semantic vendor-only-type message. Same class as the op_sys_* operators.
		"type_codesys_vector",
		// CS-accepts / TC-rejects with vendor-specific text (`'%' is no component of …`); the LSP has its own
		// partial-access message. Left for the per-vendor decision.
		"operand_partial_word_in_dword",
		// Not yet mirrored — plain text-match work, tracked here until done.
		"duplicate_declaration",
		"interface_missing_implementation",
	]),
	codesys: new Set<string>([
		// Same CS≠TC set — CODESYS's wording differs from ours; per-vendor templates or leave.
		"fb_init_missing_bInCopyCode",
		"fb_exit_missing_bInCopyCode",
		"identifier_double_underscore",
		"identifier_consecutive_underscores",
		"deref_on_array_type",
		"conditional_orphan_else",
		"op_modulo_on_real",
		"oop_abstract_instantiated",
		"type_var_temp_in_method",
		"type_deref_non_pointer",
		"var_non_retain",
		"operand_uchar_literal",
		"unresolved_identifier_in_body",
		"duplicate_declaration",
		"interface_missing_implementation",
		// String LITERAL source type rendered as `STRING(INT#<len>)` by CODESYS; our inference yields `STRING`.
		"literal_string_to_int_assignment",
		// CODESYS emits an EXTRA warning our external-write check doesn't (`The attribute … is unknown and will
		// be ignored`) alongside the mirrored `'X' is no input` error → message SETS differ. The error matches;
		// the surplus IDE warning is a CODESYS-only attribute-lint we don't model.
		"unknown_attribute_typo",
		"monitoring_encoding",
		// CODESYS reports the undefined `exc` as an ERROR (`Identifier 'exc' not defined`); the LSP emits a
		// WARNING (`'exc' is not defined in any reachable scope`) — the same severity-gated unresolved-id case.
		"op_sys_try_catch",
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

				it(`LSP diagnostics agree with ${vendor}`, () => {
					const lspDiags = runLsp(test.source, testIdx, vendor);
					// Compare error+warning presence only — symmetric with the recorder, which drops CODESYS
					// info-severity noise (`record-language.ts`). The LSP's `information`/`hint` diagnostics
					// (e.g. `{info}`/`{text}` message pragmas, shadowing) have no ground-truth counterpart, so
					// counting them would be an unfair asymmetry.
					const significant = (sev: string): boolean => sev === "error" || sev === "warning";
					const lspFlagged = lspDiags.some((d) => significant(d.severity));
					const recordedFlagged = recorded.diagnostics.some((d) => significant(d.severity));

					// HARD assertion: did the LSP flag the same code the IDE
					// flagged? Skipped for documented per-test divergences
					// (KNOWN_DIVERGENCES). Snapshot below captures
					// diagnostic detail for regression diffs in either case.
					const isKnownDivergent = KNOWN_DIVERGENCES[vendor].has(test.name);
					if (!isKnownDivergent) {
						expect({
							lspFlagged,
							ideFlagged: recordedFlagged,
						}).toEqual({
							lspFlagged: recordedFlagged,
							ideFlagged: recordedFlagged,
						});
					}

					// MESSAGE mirror: where both sides flag the same code, enforce that the LSP's error+warning
					// text reads IDENTICALLY to the compiler's. Skipped for presence-divergent fixtures (nothing
					// to compare) and for documented text exceptions (KNOWN_MESSAGE_DIVERGENCES — CS≠TC wording,
					// parse cascades, severity-gated, or not-yet-mirrored). This is what verifies the "mirror the
					// IDE" hypothesis and holds each fix against regression.
					const msgSet = (ds: ReadonlyArray<{ severity: string; message: string }>): string[] =>
						ds.filter((d) => significant(d.severity)).map((d) => `[${d.severity}] ${d.message}`).sort();
					if (!isKnownDivergent && lspFlagged && recordedFlagged && !KNOWN_MESSAGE_DIVERGENCES[vendor].has(test.name)) {
						expect(msgSet(lspDiags)).toEqual(msgSet(recorded.diagnostics));
					}

					expect({
						name: test.name,
						vendor,
						knownDivergent: isKnownDivergent,
						ideErrors: recorded.diagnostics.filter((d) => d.severity === "error").length,
						ideWarnings: recorded.diagnostics.filter((d) => d.severity === "warning").length,
						ideMessages: recorded.diagnostics.map((d) => `[${d.severity}] ${d.message}`),
						lspErrors: lspDiags.filter((d) => d.severity === "error").length,
						lspWarnings: lspDiags.filter((d) => d.severity === "warning").length,
						lspMessages: lspDiags.map((d) => `[${d.severity}] ${d.message}`),
					}).toMatchSnapshot();
				});
			});
		}
	});
}
