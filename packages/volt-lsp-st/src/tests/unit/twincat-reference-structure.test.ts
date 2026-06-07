/**
 * Structure tests for `docs/twincat-reference/`.
 *
 * These are lock-in tests: if a file is renamed, deleted, or a new one is
 * added without updating the index, a test here fails. They also verify the
 * minimum editorial requirements for the "deltas-only" corpus:
 *   • every delta file cites a Beckhoff InfoSys source URL
 *   • every delta file cross-references the shared codesys-reference corpus
 *   • the index links every numbered section
 *
 * No internet access needed — all checks are against the files on disk.
 */
import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TC_DOCS_DIR = join(PKG_DIR, "docs", "twincat-reference");

const EXPECTED_FILES = [
	"00-index.md",
	"01-languages.md",
	"02-variables.md",
	"03-operators.md",
	"04-type-conversion.md",
	"05-operands.md",
	"06-data-types.md",
	"07-pragmas.md",
	"08-identifiers.md",
	"09-shadowing.md",
	"10-keywords.md",
	"11-fb-lifecycle.md",
	"12-global-init-slots.md",
	"13-error-messages.md",
	"14-libraries.md",
];

// Sections that the index must link (filename only, without path prefix).
const SECTIONS_01_14 = EXPECTED_FILES.slice(1); // everything except 00-index.md

// ── Presence and completeness ───────────────────────────────────────────────

describe("twincat-reference: file presence", () => {
	it("contains exactly the 15 expected files (no missing, no extras)", async () => {
		const entries = await readdir(TC_DOCS_DIR);
		const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
		expect(mdFiles).toEqual([...EXPECTED_FILES].sort());
	});

	it("each file is non-empty", async () => {
		for (const file of EXPECTED_FILES) {
			const content = await readFile(join(TC_DOCS_DIR, file), "utf-8");
			expect(content.trim().length, `${file} is empty`).toBeGreaterThan(0);
		}
	});
});

// ── Heading structure ────────────────────────────────────────────────────────

describe("twincat-reference: heading structure", () => {
	it("every file starts with a level-1 heading (#)", async () => {
		for (const file of EXPECTED_FILES) {
			const content = await readFile(join(TC_DOCS_DIR, file), "utf-8");
			const firstLine = content.split("\n")[0] ?? "";
			expect(firstLine.startsWith("#"), `${file} does not start with a # heading`).toBe(true);
		}
	});
});

// ── Index completeness ───────────────────────────────────────────────────────

describe("twincat-reference: index links", () => {
	it("00-index.md links to every numbered section (01–14)", async () => {
		const index = await readFile(join(TC_DOCS_DIR, "00-index.md"), "utf-8");
		for (const section of SECTIONS_01_14) {
			expect(index, `00-index.md does not link ${section}`).toContain(section);
		}
	});
});

// ── Editorial requirements (delta files only) ────────────────────────────────

describe("twincat-reference: Beckhoff source citations", () => {
	it("every delta file (01–14) cites an infosys.beckhoff.com URL", async () => {
		for (const file of SECTIONS_01_14) {
			const content = await readFile(join(TC_DOCS_DIR, file), "utf-8");
			expect(
				content.includes("infosys.beckhoff.com"),
				`${file} is missing a Beckhoff InfoSys source URL`,
			).toBe(true);
		}
	});
});

describe("twincat-reference: codesys-reference cross-references", () => {
	it("every delta file (01–14) mentions codesys-reference (linking to the shared base)", async () => {
		for (const file of SECTIONS_01_14) {
			const content = await readFile(join(TC_DOCS_DIR, file), "utf-8");
			expect(
				content.includes("codesys-reference") || content.includes("codesys reference"),
				`${file} does not cross-reference codesys-reference`,
			).toBe(true);
		}
	});
});
