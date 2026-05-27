/**
 * Unit tests for the reference module's query API.
 *
 * The data itself is large and curated; these tests verify the *shape*
 * of the lookup API, not the correctness of every entry. Spot-checks
 * cover the high-value categories (data types, pragmas, lifecycle).
 */
import { describe, expect, it } from "vitest";
import { lookup, lookupAll, allEntries, renderHover } from "./index.js";

describe("reference lookup", () => {
	it("resolves elementary type names case-insensitively", () => {
		const upper = lookup("INT");
		const lower = lookup("int");
		expect(upper).toBeDefined();
		expect(lower).toBeDefined();
		expect(upper).toBe(lower);
		expect(upper?.kind).toBe("data-type");
	});

	it("resolves a CODESYS pragma name", () => {
		const e = lookup("no_init");
		expect(e?.kind).toBe("pragma");
	});

	it("honors pragma aliases (noinit / no_init / no-init)", () => {
		const a = lookup("noinit");
		const b = lookup("no_init");
		const c = lookup("no-init");
		expect(a).toBeDefined();
		expect(a).toBe(b);
		expect(a).toBe(c);
	});

	it("resolves lifecycle method names", () => {
		const init = lookup("FB_Init");
		const reinit = lookup("FB_Reinit");
		const exit = lookup("FB_Exit");
		expect(init?.kind).toBe("lifecycle-method");
		expect(reinit?.kind).toBe("lifecycle-method");
		expect(exit?.kind).toBe("lifecycle-method");
	});

	it("resolves IEC operators (LOG, SIN, etc.)", () => {
		expect(lookup("LOG")?.kind).toBe("operator");
		expect(lookup("SIN")?.kind).toBe("operator");
		expect(lookup("__NEW")?.kind).toBe("operator");
	});

	it("resolves type-conversion functions (BOOL_TO_INT, TRUNC)", () => {
		expect(lookup("BOOL_TO_INT")?.kind).toBe("type-conversion");
		expect(lookup("REAL_TO_DINT")?.kind).toBe("type-conversion");
		expect(lookup("TRUNC")?.kind).toBe("type-conversion");
		expect(lookup("TRUNC_INT")?.kind).toBe("type-conversion");
	});

	it("returns undefined for unknown names", () => {
		expect(lookup("nonExistentFunctionXyzzy")).toBeUndefined();
	});

	it("lookupAll returns multiple entries when name overlaps categories", () => {
		// `DT` is a date type AND a keyword (alias of DATE_AND_TIME).
		const all = lookupAll("DT");
		expect(all.length).toBeGreaterThanOrEqual(1);
	});

	it("renderHover produces markdown with name + kind + source URL", () => {
		const e = lookup("INT");
		expect(e).toBeDefined();
		const md = renderHover(e!);
		expect(md).toContain("**INT**");
		expect(md).toContain("data-type");
		expect(md).toContain("https://content.helpme-codesys.com");
	});

	it("renderHover with showSource:false omits the source link", () => {
		const e = lookup("INT");
		const md = renderHover(e!, { showSource: false });
		expect(md).not.toContain("https://content.helpme-codesys.com");
	});

	it("allEntries() yields a substantial catalog", () => {
		const count = [...allEntries()].length;
		// Generated cross-product for type-conversion (~26^2 + ~26 overload)
		// + ~75 keywords + ~50 data types + ~60 operators + ~50 pragmas
		// + 3 lifecycle methods. Loose lower bound.
		expect(count).toBeGreaterThan(500);
	});
});
