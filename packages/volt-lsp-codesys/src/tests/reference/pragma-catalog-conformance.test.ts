/**
 * Catalog conformance — pin the required shape of every PRAGMA entry.
 *
 * The pragma catalog (`reference/pragmas.ts`) is the single source of
 * truth for hover, completion, the unknown-pragma diagnostic, and
 * companion / conflict checks. A malformed entry — missing
 * `oneLiner`, empty `syntax`, unknown `category` — silently degrades
 * the LSP for every code path that reads it (hover shows blank, the
 * snippet inserts nothing, etc.). This test catches that the moment
 * an entry is added or edited.
 *
 * Pragmatically: this is the structural test the user asked for —
 * "we need to know the list is complete." We can't enforce
 * *external* completeness (CODESYS may add new pragmas in any SP
 * release), but we CAN enforce that whatever IS in the catalog is
 * well-formed and self-consistent.
 */
import { describe, expect, test } from "bun:test";
import { ALL_PRAGMAS, PRAGMAS } from "../../reference/pragmas.js";

const VALID_CATEGORIES = new Set(["message", "attribute", "conditional", "region"]);
const VALID_VENDORS = new Set(["shared", "codesys", "twincat"]);

describe("pragma catalog conformance", () => {
	test("catalog is non-empty (the LSP loaded a real reference, not the empty file)", () => {
		expect(ALL_PRAGMAS.length).toBeGreaterThan(50);
	});

	test("every entry has the required fields populated", () => {
		const failures: string[] = [];
		for (const e of ALL_PRAGMAS) {
			if (typeof e.name !== "string" || e.name.length === 0) failures.push("(unnamed): missing name");
			else if (typeof e.oneLiner !== "string" || e.oneLiner.length === 0) failures.push(`${e.name}: missing oneLiner`);
			else if (typeof e.syntax !== "string" || e.syntax.length === 0) failures.push(`${e.name}: missing syntax`);
			else if (!VALID_CATEGORIES.has(e.category)) failures.push(`${e.name}: invalid category '${e.category}'`);
			else if (!VALID_VENDORS.has(e.vendor)) failures.push(`${e.name}: invalid vendor '${e.vendor}'`);
		}
		expect(failures).toEqual([]);
	});

	test("every entry's name is unique (case-insensitive) — no silent overwrites", () => {
		const seen = new Map<string, string>();
		const dupes: string[] = [];
		for (const e of ALL_PRAGMAS) {
			const key = e.name.toLowerCase();
			const prior = seen.get(key);
			if (prior !== undefined) dupes.push(`'${e.name}' duplicates '${prior}'`);
			else seen.set(key, e.name);
		}
		expect(dupes).toEqual([]);
	});

	test("PRAGMAS lookup map covers every entry name + every alias", () => {
		const missing: string[] = [];
		for (const e of ALL_PRAGMAS) {
			if (!PRAGMAS.has(e.name.toLowerCase())) missing.push(e.name);
			for (const a of e.aliases ?? []) {
				if (!PRAGMAS.has(a.toLowerCase())) missing.push(`${e.name} (alias '${a}')`);
			}
		}
		expect(missing).toEqual([]);
	});

	test("`requires` references resolve to other catalog entries", () => {
		const names = new Set(ALL_PRAGMAS.map((e) => e.name.toLowerCase()));
		const broken: string[] = [];
		for (const e of ALL_PRAGMAS) {
			for (const r of e.requires ?? []) {
				if (!names.has(r.toLowerCase())) broken.push(`${e.name} requires unknown '${r}'`);
			}
		}
		expect(broken).toEqual([]);
	});

	test("`forbids` references resolve to other catalog entries", () => {
		const names = new Set(ALL_PRAGMAS.map((e) => e.name.toLowerCase()));
		const broken: string[] = [];
		for (const e of ALL_PRAGMAS) {
			for (const f of e.forbids ?? []) {
				if (!names.has(f.toLowerCase())) broken.push(`${e.name} forbids unknown '${f}'`);
			}
		}
		expect(broken).toEqual([]);
	});

	test("user-reported missing pragmas are now catalogued (regression)", () => {
		// Both `symbol` (Symbol Configuration) and `strict` (POU type-
		// checking) were used in real hauzer code but absent from the
		// catalog — they fired the unknown-pragma diagnostic. This pins
		// the fix so a future catalog reorganization can't silently
		// drop them.
		expect(PRAGMAS.has("symbol")).toBe(true);
		expect(PRAGMAS.has("strict")).toBe(true);
		expect(PRAGMAS.has("qualified_only")).toBe(true);
	});
});
