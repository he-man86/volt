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

/** Facts for an elementary type name (case-insensitive), or undefined if not elementary. */
export function elementaryType(name: string): ElementaryType | undefined {
	return ELEMENTARY_TYPES.get(name.toUpperCase());
}

/** True when the type participates in the numeric widening lattice (int / bit-string / real). */
export function isNumeric(t: ElementaryType): boolean {
	return t.rank !== undefined;
}
