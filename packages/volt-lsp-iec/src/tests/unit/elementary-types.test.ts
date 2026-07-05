/**
 * Golden test for the type-facts SSOT (`type-system/elementary.ts`).
 *
 * Proves the derived views reproduce the scattered legacy sets EXACTLY before those sets are deleted
 * (restructure-semantic-foundation task C.1/C.2). The legacy sets are encoded here verbatim (from the audit)
 * as the reference; if a derivation drifts, this fails. Comparison is over canonical short-form names — the
 * legacy long-form date entries (`TIME_OF_DAY`, `DATE_AND_TIME`, …) were provably dead (callers pre-
 * canonicalize), so they don't affect functional behavior.
 */
import { describe, expect, it } from "bun:test";
import {
	ELEMENTARY_TYPES, canonicalElem, elementaryType,
	numericRank, isIntegerType, isNumericType, isIsolated, isEnumIsolated, isDatetime, isDuration, isKnownPrimitive,
} from "../../semantic/type-system/elementary.js";

/** Every canonical elementary name (the table's keys). */
const ALL = [...ELEMENTARY_TYPES.keys()];

// ─── Legacy sets, verbatim (canonical short forms), as the golden reference ───
const LEGACY_NUMERIC_RANK: Record<string, number> = {
	SINT: 1, USINT: 1, BYTE: 1, INT: 2, UINT: 2, WORD: 2, DINT: 3, UDINT: 3, DWORD: 3,
	LINT: 4, ULINT: 4, LWORD: 4, REAL: 5, LREAL: 6,
};
const LEGACY_INTEGER = new Set(["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT", "BYTE", "WORD", "DWORD", "LWORD"]);
const LEGACY_NUMERIC = new Set([...LEGACY_INTEGER, "REAL", "LREAL"]);
const LEGACY_ISOLATED = new Set(["BOOL", "STRING", "WSTRING", "TIME", "LTIME", "DATE", "TOD", "DT", "LDATE", "LDT", "LTOD"]);
const LEGACY_ENUM_ISOLATED = new Set([...LEGACY_ISOLATED, "REAL", "LREAL"]);
const LEGACY_DATETIME = new Set(["DATE", "TOD", "DT", "LDATE", "LTOD", "LDT"]);
const LEGACY_DURATION = new Set(["TIME", "LTIME"]);

describe("elementary SSOT: derived views reproduce the legacy sets exactly", () => {
	it("numericRank == legacy NUMERIC_RANK", () => {
		for (const n of ALL) expect(numericRank(n)).toBe(LEGACY_NUMERIC_RANK[n]); // undefined where absent (BOOL/BIT/time/date/string)
	});
	it("isIntegerType == legacy INTEGER_TYPES (BIT excluded)", () => {
		for (const n of ALL) expect(isIntegerType(n)).toBe(LEGACY_INTEGER.has(n));
	});
	it("isNumericType == legacy NUMERIC_TYPES", () => {
		for (const n of ALL) expect(isNumericType(n)).toBe(LEGACY_NUMERIC.has(n));
	});
	it("isIsolated == legacy ISOLATED", () => {
		for (const n of ALL) expect(isIsolated(n)).toBe(LEGACY_ISOLATED.has(n));
	});
	it("isEnumIsolated == legacy ENUM_ISOLATED", () => {
		for (const n of ALL) expect(isEnumIsolated(n)).toBe(LEGACY_ENUM_ISOLATED.has(n));
	});
	it("isDatetime == legacy DATETIME_TYPES", () => {
		for (const n of ALL) expect(isDatetime(n)).toBe(LEGACY_DATETIME.has(n));
	});
	it("isDuration == legacy DURATION_TYPES", () => {
		for (const n of ALL) expect(isDuration(n)).toBe(LEGACY_DURATION.has(n));
	});
});

describe("elementary SSOT: aliases + facts", () => {
	it("canonicalElem resolves the IEC abbreviations (was ELEM_ABBREV)", () => {
		expect(canonicalElem("TIME_OF_DAY")).toBe("TOD");
		expect(canonicalElem("DATE_AND_TIME")).toBe("DT");
		expect(canonicalElem("LDATE_AND_TIME")).toBe("LDT");
		expect(canonicalElem("LTIME_OF_DAY")).toBe("LTOD");
		expect(canonicalElem("int")).toBe("INT"); // upper-cases
	});
	it("elementaryType resolves via alias and carries the range", () => {
		expect(elementaryType("TIME_OF_DAY")).toBe(elementaryType("TOD"));
		expect(elementaryType("INT")!.range).toEqual({ min: -32768n, max: 32767n });
		expect(elementaryType("BYTE")!.range).toEqual({ min: 0n, max: 255n });
		expect(elementaryType("LWORD")!.range!.max).toBe(18446744073709551615n); // 2^64-1, exact via bigint
		expect(elementaryType("NotAType")).toBeUndefined();
	});
	it("isKnownPrimitive covers elementary + ANY_* + POINTER (was type-resolver ELEMENTARY_TYPES)", () => {
		for (const n of ["BOOL", "INT", "STRING", "TIME_OF_DAY", "ANY", "ANY_INT", "ANY_MAGNITUDE", "POINTER"]) {
			expect(isKnownPrimitive(n)).toBe(true);
		}
		expect(isKnownPrimitive("FB_Motor")).toBe(false);
	});
});
