/**
 * Real-world corpus regression tests.
 *
 * Walks every fixture under `test-fixtures/tc3-basic/` (mirror of the
 * TC3_PlcSample_BasicPlcElements TwinCAT 3 sample), feeds each file
 * to the parser, and asserts:
 *
 *   1. No exception is thrown (any throw = parser crash on real code)
 *   2. At least one top-level unit is produced (silent total-miss bug)
 *   3. ZERO parse errors (anything TwinCAT accepts should parse cleanly)
 *   4. Structural snapshot per file — kinds, names, child counts — so
 *      deliberate parser-output changes surface in code review
 *
 * Why a fixture corpus instead of more inline snippets: every other
 * test in this package uses 5-to-10-line synthetic strings. Those
 * prove the parser handles the patterns we THOUGHT to write. The
 * corpus proves it handles patterns engineers ACTUALLY write —
 * including pragma stacks, multi-line attribute clusters, and
 * graphical-body placeholders that synthetic tests never cover.
 *
 * Refresh procedure: see `test-fixtures/README.md`.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "./parser.js";
import type { ParseResult, TopLevel, VarSection } from "./ast.js";
import { buildDocumentSymbols } from "../lsp/queries/document-symbol.js";

const FIXTURES_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"test-fixtures",
	"tc3-basic",
);

const POU_EXT_RE = /\.(st|gvl|dut|itf|fbd|ld|sfc|cfc)$/i;

interface Fixture {
	relPath: string;
	content: string;
}

function walkFixtures(): Fixture[] {
	const out: Fixture[] = [];
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && POU_EXT_RE.test(entry.name)) {
				out.push({
					relPath: relative(FIXTURES_DIR, full).split(/[/\\]/).join("/"),
					content: readFileSync(full, "utf-8"),
				});
			}
		}
	}
	walk(FIXTURES_DIR);
	return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Reduce a ParseResult to a span-free structural fingerprint suitable
 * for snapshotting. Drops everything position-sensitive (spans, raw
 * tokens) so unrelated whitespace edits don't flip the snapshot.
 */
function structureOf(result: ParseResult): unknown {
	return {
		unitCount: result.units.length,
		units: result.units.map(unitShape),
		errors: result.errors.map((e) => ({ message: e.message })),
	};
}

function unitShape(unit: TopLevel): unknown {
	const base = { kind: unit.kind, name: nameOf(unit) };
	switch (unit.kind) {
		case "function_block":
			return {
				...base,
				abstract: unit.abstract === true,
				final: unit.final === true,
				extends: unit.extends?.text,
				implements: unit.implements?.map((i) => i.text),
				varSections: unit.varSections.map(varSectionShape),
			};
		case "program":
		case "function":
			return {
				...base,
				...(unit.kind === "function" && unit.returnType !== undefined
					? { hasReturnType: true }
					: {}),
				varSections: unit.varSections.map(varSectionShape),
			};
		case "method":
			return {
				...base,
				access: unit.access,
				final: unit.final === true,
				abstract: unit.abstract === true,
				override: unit.override === true,
				hasReturnType: unit.returnType !== undefined,
				varSections: unit.varSections.map(varSectionShape),
			};
		case "action":
			return base;
		case "property":
			return {
				...base,
				access: unit.access,
				hasGetter: unit.getter !== undefined,
				hasSetter: unit.setter !== undefined,
			};
		case "interface":
			return {
				...base,
				methodCount: unit.methods.length,
				propertyCount: unit.properties.length,
				extends: unit.extends?.map((e) => e.text),
			};
		case "type_decl":
			return { ...base, dutKind: unit.body.kind };
		case "global_var_list":
			return { ...base, varSections: unit.varSections.map(varSectionShape) };
		case "namespace":
			return { ...base, innerUnitCount: unit.units.length };
		default:
			return base;
	}
}

function varSectionShape(s: VarSection): unknown {
	return { kind: s.kind, declCount: s.decls.length };
}

function nameOf(unit: TopLevel): string | undefined {
	if ("name" in unit && unit.name !== undefined) return unit.name.text;
	return undefined;
}

// ────────────────────────────────────────────────────────────────────

const fixtures = walkFixtures();

describe("corpus: TC3_PlcSample_BasicPlcElements", () => {
	it("discovers a non-empty fixture set", () => {
		// Guard against accidentally-empty fixtures dir (broken refresh,
		// .gitignore mistake) — would silently degrade this whole suite
		// into a no-op otherwise.
		expect(fixtures.length).toBeGreaterThan(0);
	});

	for (const fx of fixtures) {
		describe(fx.relPath, () => {
			let result: ParseResult;

			it("parses without throwing", () => {
				// Any thrown exception fails this test — parser must
				// always return a ParseResult, even for malformed input.
				result = parseSource(fx.content);
				expect(result).toBeDefined();
			});

			it("yields at least one top-level unit", () => {
				result ??= parseSource(fx.content);
				expect(result.units.length).toBeGreaterThan(0);
			});

			it("reports no parse errors", () => {
				result ??= parseSource(fx.content);
				// Real TwinCAT-accepted code must parse cleanly. Any
				// error here means the parser can't handle a real-world
				// construct — file the bug, then add a synthetic test
				// for the specific minimal trigger.
				expect(result.errors).toEqual([]);
			});

			it("matches its structural snapshot", () => {
				result ??= parseSource(fx.content);
				expect(structureOf(result)).toMatchSnapshot();
			});

			it("produces document symbols matching snapshot", () => {
				result ??= parseSource(fx.content);
				// Strip ranges — they're position-sensitive and would
				// invalidate the snapshot on any whitespace edit.
				const symbols = stripRanges(buildDocumentSymbols(result));
				expect(symbols).toMatchSnapshot();
			});
		});
	}
});

function stripRanges(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripRanges);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (k === "range" || k === "selectionRange") continue;
			out[k] = stripRanges(v);
		}
		return out;
	}
	return value;
}
