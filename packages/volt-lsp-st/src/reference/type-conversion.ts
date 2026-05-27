/**
 * CODESYS type-conversion operators. Source:
 * `docs/codesys-reference/04-type-conversion.md`.
 *
 * Pattern: `<SRC>_TO_<DST>(value)` for every elementary-type pair, plus
 * the overloaded `TO_<DST>(value)` and the special `TRUNC` / `TRUNC_INT`.
 *
 * The combinatorial space is huge (~25 × ~25 = ~625 valid pairs) — we
 * enumerate the patterns and generate the catalog procedurally.
 */

import type { ReferenceEntry } from "./index.js";

/**
 * Extended entry shape — carries source/dest types so the
 * conversion-source-mismatch diagnostic can validate calls.
 *
 * `sourceType` / `destType` use the canonical CODESYS uppercase
 * elementary-type spelling (matches what the symbol table records
 * in `Symbol.typeExpr.name.text` for declared vars).
 */
export interface ConversionEntry extends ReferenceEntry {
	sourceType: string;
	destType: string;
}

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html",
	localFile: "docs/codesys-reference/04-type-conversion.md",
	retrievedAt: "2026-05-26",
};

/**
 * Elementary type names that participate in `<SRC>_TO_<DST>` /
 * `TO_<DST>` conversions. Order matters: this is also the order we
 * register them so duplicate entries (the smaller types win for hover).
 */
const ELEMENTARY_TYPES = [
	"BOOL",
	"SINT",
	"USINT",
	"INT",
	"UINT",
	"DINT",
	"UDINT",
	"LINT",
	"ULINT",
	"BYTE",
	"WORD",
	"DWORD",
	"LWORD",
	"REAL",
	"LREAL",
	"STRING",
	"WSTRING",
	"TIME",
	"LTIME",
	"DATE",
	"LDATE",
	"DT",
	"LDT",
	"TOD",
	"LTOD",
	"BIT",
] as const;

type ElementaryType = (typeof ELEMENTARY_TYPES)[number];

function pairOneLiner(src: ElementaryType, dst: ElementaryType): string {
	return `Convert ${src} to ${dst}. \`${src}_TO_${dst}(value)\`.`;
}

function makeConversion(
	name: string,
	sourceType: string,
	destType: string,
	oneLiner: string,
	opts?: {
		details?: string;
		gotchas?: string[];
	},
): ConversionEntry {
	// Type-conversion operators are IEC-derived and identical between
	// CODESYS and TwinCAT.
	return {
		name,
		kind: "type-conversion",
		source: SOURCE,
		vendor: "shared",
		sourceType,
		destType,
		oneLiner,
		details: opts?.details,
		gotchas: opts?.gotchas,
	};
}

const ENTRIES: ConversionEntry[] = [];

// Generate the cross-product. Self-conversions (X_TO_X) are valid but
// uninteresting — include them for completeness.
for (const src of ELEMENTARY_TYPES) {
	for (const dst of ELEMENTARY_TYPES) {
		const name = `${src}_TO_${dst}`;
		const oneLiner = pairOneLiner(src, dst);
		const gotchas: string[] = [];
		// Document the high-risk pairs explicitly.
		if ((src === "REAL" || src === "LREAL") && dst !== "REAL" && dst !== "LREAL" && dst !== "STRING" && dst !== "WSTRING") {
			gotchas.push("REAL/LREAL → integer is UNDEFINED behavior if value is out of range. Target-dependent.");
		}
		if (dst === "BIT" && src !== "BOOL") {
			gotchas.push("Conversion to BIT requires a BOOL-like source.");
		}
		ENTRIES.push(makeConversion(name, src, dst, oneLiner, gotchas.length > 0 ? { gotchas } : undefined));
	}
}

// Overloaded `TO_<DST>(value)` form. Source is "ANY" — diagnostic
// skips the source check for these since the type is inferred.
for (const dst of ELEMENTARY_TYPES) {
	ENTRIES.push(
		makeConversion(
			`TO_${dst}`,
			"ANY",
			dst,
			`Overloaded conversion to ${dst}. Source type inferred from argument.`,
			{
				details: `Equivalent to \`<SRC>_TO_${dst}(value)\` with the source type taken from the argument's declared type.`,
			},
		),
	);
}

// TRUNC / TRUNC_INT — special REAL → integer with explicit truncation.
// Source is REAL (also accepts LREAL in practice — track as REAL).
ENTRIES.push(
	makeConversion(
		"TRUNC",
		"REAL",
		"DINT",
		"Truncate REAL to DINT (V3 semantics). Discards fractional part.",
		{
			gotchas: [
				"V2.3 → V3 trap: in V2.3, TRUNC returned INT. Auto-replaced with TRUNC_INT during project import.",
				"Behavior is undefined if the REAL value is out of DINT range.",
			],
		},
	),
);
ENTRIES.push(
	makeConversion(
		"TRUNC_INT",
		"REAL",
		"INT",
		"Truncate REAL to INT. Discards fractional part.",
		{
			gotchas: ["Behavior is undefined if the REAL value is out of INT range."],
		},
	),
);

export const TYPE_CONVERSIONS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

/** Typed accessor used by the conversion-source-mismatch diagnostic. */
export function getConversion(name: string): ConversionEntry | undefined {
	const lower = name.toLowerCase();
	return ENTRIES.find((e) => e.name.toLowerCase() === lower);
}

/**
 * Compatible source types for the conversion. The named source
 * accepts any type in the same family — e.g. SINT/USINT/INT/UINT/
 * DINT/UDINT all "fit" INT_TO_DINT loosely (CODESYS allows implicit
 * widening). The diagnostic uses this to avoid false positives on
 * narrow widening differences.
 */
export function isAcceptableSource(entry: ConversionEntry, argType: string): boolean {
	if (entry.sourceType === "ANY") return true; // overloaded TO_<X>
	const want = entry.sourceType.toUpperCase();
	const got = argType.toUpperCase();
	if (want === got) return true;

	// Allow integer-family widening (the conversion still works on a
	// narrower integer because the compiler implicitly widens).
	const integerFamily = new Set([
		"BYTE", "WORD", "DWORD", "LWORD",
		"SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT", "BIT",
	]);
	if (want === "INT" || want === "DINT" || want === "LINT") {
		// Accept any signed integer; the compiler widens implicitly.
		if (integerFamily.has(got)) return true;
	}

	// REAL accepts LREAL and vice versa for our purposes (we won't
	// fight CODESYS on float precision).
	if ((want === "REAL" && got === "LREAL") || (want === "LREAL" && got === "REAL")) return true;

	// Date family — DT accepts LDT, etc.
	const dateFamily = new Set(["DATE", "LDATE", "DT", "LDT", "TOD", "LTOD"]);
	if (dateFamily.has(want) && dateFamily.has(got)) return true;

	return false;
}

/**
 * Find every conversion whose source type matches `argType`. Used
 * by the diagnostic to suggest the right conversion name.
 */
export function conversionsForSource(argType: string, destType?: string): ConversionEntry[] {
	return ENTRIES.filter((e) => {
		if (!isAcceptableSource(e, argType)) return false;
		if (destType !== undefined && e.destType.toUpperCase() !== destType.toUpperCase()) return false;
		return true;
	});
}
