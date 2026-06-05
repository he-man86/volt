/**
 * Registry self-tests. These guard against the most common slips
 * when adding a new tracked kind:
 *   - duplicate kind / ext claims
 *   - source kinds missing the LF normalization in .gitattributes
 *   - language overrides that don't round-trip
 *
 * These tests target only the registry itself — no test bridge, no
 * workspace, no IO. They WILL move to `tests/scenarios/registry-
 * invariants.test.ts` in Phase E along with the rest of the test
 * restructure.
 */
import { describe, expect, test } from "bun:test";

import {
	EXTENSIONS,
	FOLDER_MARKER,
	getByExt,
	getByKind,
	getByPath,
	gitattributesContent,
	isTrackedPath,
	nameFromPath,
	pickExtension,
	sourceExtensions,
	trackedExtensions,
} from "../../../engine/extension-registry.js";
import { effectiveAccess, isPullable, isPushable } from "../../../engine/access.js";

describe("extension registry", () => {
	test("every kind is unique", () => {
		const seen = new Set<string>();
		for (const def of EXTENSIONS) {
			expect(seen.has(def.kind)).toBe(false);
			seen.add(def.kind);
		}
	});

	test("every reachable extension maps back to exactly one kind", () => {
		// `BY_EXT` allows the same def to be reached via primary OR
		// language-override extensions. What we forbid is TWO DIFFERENT
		// defs claiming the same extension. The registry's module-init
		// throws on this, so the test just checks the throw didn't fire
		// (we got this far).
		for (const ext of trackedExtensions()) {
			expect(getByExt(ext)).toBeDefined();
		}
	});

	test("getByPath finds the right family for any workspace path", () => {
		// `.st` is shared by function_block / function / program — the
		// representative kind is unspecified by design (workspace
		// doesn't need to know; the bridge owns POU sub-classification).
		// What we DO assert: the family + access are stable.
		const st = getByPath("POUs/FB_Motor.st");
		expect(st?.family).toBe("source");
		expect(st?.defaultAccess).toBe("rw");
		// Unique-kind extensions resolve precisely.
		expect(getByPath("Device/Plc Logic/Application/MainTask.task")?.kind).toBe("task");
		expect(getByPath("Library Manager/IoStandard.library")?.kind).toBe("library");
		expect(getByPath("Visu_X.visualization")?.kind).toBe("visualization");
		expect(getByPath("unknown.weird")).toBeUndefined();
	});

	test("pickExtension respects language overrides", () => {
		expect(pickExtension("function_block", "ST")).toBe("st");
		expect(pickExtension("function_block", "FBD")).toBe("fbd");
		expect(pickExtension("function_block", "LD")).toBe("ld");
		expect(pickExtension("function_block", "CFC")).toBe("cfc");
		expect(pickExtension("function_block", "SFC")).toBe("sfc");
		// Declaration-only kinds ignore language.
		expect(pickExtension("gvl", "FBD")).toBe("gvl");
		expect(pickExtension("interface", "LD")).toBe("itf");
	});

	test("pickExtension throws on unknown kind (no silent fallback)", () => {
		expect(() => pickExtension("not_a_kind")).toThrow(/unknown kind/);
	});

	test("pickExtension throws when source POU language is missing or UNKNOWN", () => {
		// Source POU kind without a language is the bug we're fixing —
		// the bridge used to silently fall back to ST, and the agent
		// used to silently return `.st`. Both fallbacks are gone; the
		// caller must commit to a real language.
		expect(() => pickExtension("function_block")).toThrow(/requires a body language/);
		expect(() => pickExtension("function_block", "UNKNOWN")).toThrow(/no extension mapping/);
		expect(() => pickExtension("function_block", "PASCAL")).toThrow(/no extension mapping/);
	});

	test("nameFromPath recovers item name from any tracked ext", () => {
		expect(nameFromPath("POUs/FB_Motor.st")).toBe("FB_Motor");
		expect(nameFromPath("Library Manager/IoStandard.library")).toBe("IoStandard");
		expect(nameFromPath("Visu_X.visualization")).toBe("Visu_X");
		// Folder marker — name is the parent directory.
		expect(nameFromPath("Application/SomeFolder/.gitkeep")).toBe("SomeFolder");
		// Untracked extension.
		expect(nameFromPath("notes.md")).toBeUndefined();
	});

	test("isTrackedPath recognizes every kind + .gitkeep + .gitattributes", () => {
		expect(isTrackedPath("POUs/FB_Motor.st")).toBe(true);
		expect(isTrackedPath("X.fbd")).toBe(true);
		expect(isTrackedPath("X.ld")).toBe(true);
		expect(isTrackedPath("MainTask.task")).toBe(true);
		expect(isTrackedPath("Project Information.projectinfo")).toBe(true);
		expect(isTrackedPath("a/b/.gitkeep")).toBe(true);
		expect(isTrackedPath(FOLDER_MARKER)).toBe(true);
		expect(isTrackedPath(".gitattributes")).toBe(true);
		expect(isTrackedPath("README.md")).toBe(false);
	});

	test("gitattributesContent enumerates every source ext", () => {
		const text = gitattributesContent();
		const sources = sourceExtensions();
		for (const ext of sources) {
			expect(text).toContain(`*${ext} text eol=lf`);
		}
		// Config extensions are NOT in .gitattributes — they're
		// written verbatim and may legitimately contain CRLF.
		expect(text).not.toContain("*.library");
		expect(text).not.toContain("*.device");
		expect(text).not.toContain("*.task");
	});

	test("at least one source kind covers each body language", () => {
		// Per the language overrides for FB/function/program: every
		// supported body language should be reachable via at least one
		// source kind's languageOverrides.
		const observed = new Set<string>();
		for (const def of EXTENSIONS) {
			if (def.languageOverrides === undefined) continue;
			for (const lang of Object.keys(def.languageOverrides)) observed.add(lang);
		}
		expect([...observed].sort()).toEqual(["CFC", "FBD", "LD", "SFC", "ST"].sort());
	});

	test("languageOverrides values carry { ext, access }", () => {
		// Sanity-check the new shape so a partial migration (e.g.
		// `{ ext: "fbd" }` with no `access`) doesn't slip through.
		for (const def of EXTENSIONS) {
			if (def.languageOverrides === undefined) continue;
			for (const [lang, override] of Object.entries(def.languageOverrides)) {
				expect(typeof override.ext).toBe("string");
				expect(override.ext.length).toBeGreaterThan(0);
				expect(["r", "rw"]).toContain(override.access);
				// ST is the only RW language; the graphical ones are R
				// until we ship a stable round-trip path for them.
				if (lang === "ST") {
					expect(override.access).toBe("rw");
				} else {
					expect(override.access).toBe("r");
				}
			}
		}
	});
});

describe("access mode resolution", () => {
	test("default access flows through when no overrides", () => {
		// `.st` is source → rw by default.
		expect(effectiveAccess(".st", undefined)).toBe("rw");
		expect(isPullable(".st", undefined)).toBe(true);
		expect(isPushable(".st", undefined)).toBe(true);
		// `.library` is config → r by default.
		expect(effectiveAccess(".library", undefined)).toBe("r");
		expect(isPullable(".library", undefined)).toBe(true);
		expect(isPushable(".library", undefined)).toBe(false);
	});

	test("graphical languages default to read-only despite source kind being rw", () => {
		// `.fbd`/`.ld`/`.cfc`/`.sfc` are reached via language-override on
		// source kinds whose `defaultAccess` is `rw`. They get their own
		// `r` via the per-language access mode — the engineer's IDE
		// owns the graphical body, Volt only carries it.
		expect(effectiveAccess(".fbd", undefined)).toBe("r");
		expect(effectiveAccess(".ld", undefined)).toBe("r");
		expect(effectiveAccess(".cfc", undefined)).toBe("r");
		expect(effectiveAccess(".sfc", undefined)).toBe("r");
		expect(isPushable(".fbd", undefined)).toBe(false);
		expect(isPushable(".cfc", undefined)).toBe(false);
	});

	test("config override flips access mode", () => {
		// `.fbd` defaults to read-only now; the override flips it to rw
		// so engineers can push back through a working FBD round-trip.
		const cfg = { extensionAccess: { ".library": "off", ".fbd": "rw" } } as const;
		expect(effectiveAccess(".library", cfg)).toBe("off");
		expect(isPullable(".library", cfg)).toBe(false);
		expect(isPushable(".library", cfg)).toBe(false);
		expect(effectiveAccess(".fbd", cfg)).toBe("rw");
		expect(isPushable(".fbd", cfg)).toBe(true);
	});

	test("unknown extensions resolve to 'off' regardless of config", () => {
		expect(effectiveAccess(".weird", undefined)).toBe("off");
		expect(effectiveAccess(".weird", { extensionAccess: { ".weird": "rw" } })).toBe("off");
	});

	test("case-insensitive extension lookup", () => {
		// Workspace paths can carry weird casing depending on the OS;
		// access decisions shouldn't be fragile to that.
		expect(effectiveAccess(".ST", undefined)).toBe("rw");
		expect(effectiveAccess(".LIBRARY", undefined)).toBe("r");
	});
});
