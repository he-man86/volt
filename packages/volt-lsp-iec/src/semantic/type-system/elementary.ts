/**
 * The IEC 61131-3 / CODESYS elementary type table — the single source of truth for a type's checkable facts:
 * numeric range, bit width, signedness, family, and numeric widening rank. Extracted from
 * `docs/codesys-reference/06-data-types.md` (task 0 of `st-static-typechecker`).
 *
 * Ranges are `bigint` because the 64-bit types (LWORD/LINT/ULINT) exceed JS `number`'s exact integer range;
 * constant evaluation of integers is therefore exact. REAL/LREAL carry no bigint range (they are floating —
 * their magnitude limit is checked as a `number` when needed).
 *
 * The `rank` reproduces the legacy `NUMERIC_RANK` in `check-assignment-types.ts` (SINT/USINT/BYTE=1 …
 * LREAL=6): implicit widening is allowed up the rank, narrowing is not. It is oracle-calibrated — keep it.
 */

export type TypeFamily = "bool" | "int" | "bitstring" | "real" | "time" | "date" | "string";

export interface ElementaryType {
	name: string; // canonical upper-case name
	family: TypeFamily;
	bits: number;
	signed: boolean;
	/** Exact value range for integer + bit-string types (undefined for real/bool/time/date/string). */
	range?: { min: bigint; max: bigint };
	/** Numeric widening rank (int/bit-string/real only); undefined for non-numeric families. */
	rank?: number;
}

const U = (bits: number): bigint => (1n << BigInt(bits)) - 1n; // unsigned max
const S_MIN = (bits: number): bigint => -(1n << BigInt(bits - 1)); // signed min
const S_MAX = (bits: number): bigint => (1n << BigInt(bits - 1)) - 1n; // signed max

const T = (
	name: string,
	family: TypeFamily,
	bits: number,
	signed: boolean,
	range?: { min: bigint; max: bigint },
	rank?: number,
): ElementaryType => ({ name, family, bits, signed, range, rank });

/** name → facts. All keys are canonical upper-case. */
export const ELEMENTARY_TYPES: ReadonlyMap<string, ElementaryType> = new Map(
	(
		[
			T("BOOL", "bool", 1, false, { min: 0n, max: 1n }),
			// BIT — 1-bit field type (valid only inside STRUCT/FB); bool-storage, no numeric rank.
			T("BIT", "bitstring", 1, false, { min: 0n, max: 1n }),
			// Bit-string (unsigned) — Integer ANY-group, rank by width.
			T("BYTE", "bitstring", 8, false, { min: 0n, max: U(8) }, 1),
			T("WORD", "bitstring", 16, false, { min: 0n, max: U(16) }, 2),
			T("DWORD", "bitstring", 32, false, { min: 0n, max: U(32) }, 3),
			T("LWORD", "bitstring", 64, false, { min: 0n, max: U(64) }, 4),
			// Signed integers.
			T("SINT", "int", 8, true, { min: S_MIN(8), max: S_MAX(8) }, 1),
			T("INT", "int", 16, true, { min: S_MIN(16), max: S_MAX(16) }, 2),
			T("DINT", "int", 32, true, { min: S_MIN(32), max: S_MAX(32) }, 3),
			T("LINT", "int", 64, true, { min: S_MIN(64), max: S_MAX(64) }, 4),
			// Unsigned integers.
			T("USINT", "int", 8, false, { min: 0n, max: U(8) }, 1),
			T("UINT", "int", 16, false, { min: 0n, max: U(16) }, 2),
			T("UDINT", "int", 32, false, { min: 0n, max: U(32) }, 3),
			T("ULINT", "int", 64, false, { min: 0n, max: U(64) }, 4),
			// Floating point — no exact bigint range; rank above the integers (int→real widening is implicit).
			T("REAL", "real", 32, true, undefined, 5),
			T("LREAL", "real", 64, true, undefined, 6),
			// Isolated families (no cross-family implicit conversion).
			T("TIME", "time", 32, false),
			T("LTIME", "time", 64, false),
			T("DATE", "date", 32, false),
			T("TOD", "date", 32, false),
			T("DT", "date", 64, false),
			T("LDATE", "date", 64, false),
			T("LTOD", "date", 64, false),
			T("LDT", "date", 64, false),
			T("STRING", "string", 8, false),
			T("WSTRING", "string", 16, false),
		] as ElementaryType[]
	).map((t) => [t.name, t]),
);

/** Largest finite magnitude for the floating types (doc 06), for REAL/LREAL overflow of a constant. */
export const REAL_MAX_MAGNITUDE: ReadonlyMap<string, number> = new Map([
	["REAL", 3.402823e38],
	["LREAL", 1.7976931348623157e308],
]);

/**
 * IEC abbreviations → their canonical short form, so `TIME_OF_DAY` and `TOD` compare equal. The SINGLE home
 * for this canonicalization (was `ELEM_ABBREV` in type-infer). Keyed upper-case.
 */
export const ELEM_ALIASES: ReadonlyMap<string, string> = new Map([
	["TIME_OF_DAY", "TOD"],
	["DATE_AND_TIME", "DT"],
	["LDATE_AND_TIME", "LDT"],
	["LTIME_OF_DAY", "LTOD"],
]);

/** Canonical short-form name for an elementary type (resolves the aliases above). Upper-cases. */
export function canonicalElem(name: string): string {
	const u = name.toUpperCase();
	return ELEM_ALIASES.get(u) ?? u;
}

/**
 * The `ANY_*` generic type-group families (parameter supertypes). A distinct concept from a concrete
 * elementary type — modeled as a family → its concrete members. Source: doc 06 type-group glossary.
 */
export const ANY_FAMILIES: ReadonlyMap<string, TypeFamily[]> = new Map([
	["ANY_INT", ["int", "bitstring"]],
	["ANY_REAL", ["real"]],
	["ANY_NUM", ["int", "bitstring", "real"]],
	["ANY_BIT", ["bool", "bitstring"]],
	["ANY_DATE", ["date", "time"]],
	["ANY_ELEMENTARY", ["bool", "int", "bitstring", "real", "time", "date", "string"]],
	["ANY_MAGNITUDE", ["int", "bitstring", "real", "time"]],
	["ANY_STRING", ["string"]],
	["ANY", []], // ANY = truly any; empty member list is a sentinel, not "none"
]);

/** Facts for an elementary type name (resolves aliases, case-insensitive), or undefined if not elementary. */
export function elementaryType(name: string): ElementaryType | undefined {
	return ELEMENTARY_TYPES.get(canonicalElem(name));
}

/** True when the type participates in the numeric widening lattice (int / bit-string / real). */
export function isNumeric(t: ElementaryType): boolean {
	return t.rank !== undefined;
}

// ─── Derived views — the ONE place each old scattered set is now computed from the table above ───

/** Numeric widening rank (was `NUMERIC_RANK` in check-assignment-types), or undefined for non-numeric. */
export function numericRank(name: string): number | undefined {
	return elementaryType(name)?.rank;
}

/** Integer-family names (was `INTEGER_TYPES` in check-binary-operators): int/bit-string with a rank (excludes BIT). */
export function isIntegerType(name: string): boolean {
	const t = elementaryType(name);
	return t !== undefined && t.rank !== undefined && (t.family === "int" || t.family === "bitstring");
}

/** Numeric names (was `NUMERIC_TYPES`): everything with a widening rank (integers + REAL/LREAL). */
export function isNumericType(name: string): boolean {
	return numericRank(name) !== undefined;
}

/** Assignment-isolated families — no cross-family implicit conversion (was `ISOLATED`). */
export function isIsolated(name: string): boolean {
	const f = elementaryType(name)?.family;
	return f === "bool" || f === "string" || f === "time" || f === "date";
}

/** Enum↔scalar isolated families (was `ENUM_ISOLATED`): the isolated set PLUS real. */
export function isEnumIsolated(name: string): boolean {
	return isIsolated(name) || elementaryType(name)?.family === "real";
}

/** Date/time (non-duration) family (was `DATETIME_TYPES`). */
export function isDatetime(name: string): boolean {
	return elementaryType(name)?.family === "date";
}

/** Duration family — TIME/LTIME (was `DURATION_TYPES`). */
export function isDuration(name: string): boolean {
	return elementaryType(name)?.family === "time";
}

/** A name the resolver treats as a known primitive (was `type-resolver.ELEMENTARY_TYPES`): an elementary
 *  type, an `ANY_*` generic, or the bare `POINTER` keyword. */
export function isKnownPrimitive(name: string): boolean {
	const u = name.toUpperCase();
	return elementaryType(u) !== undefined || ANY_FAMILIES.has(u) || u === "POINTER";
}
