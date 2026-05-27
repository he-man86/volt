/**
 * CODESYS elementary + derived data types. Source:
 * `docs/codesys-reference/06-data-types.md`.
 *
 * Hover content for type names. Diagnostics consume these (Phases 3-5)
 * to validate `VAR x : <type>` declarations.
 */

import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_reference_datatypes.html",
	localFile: "docs/codesys-reference/06-data-types.md",
	retrievedAt: "2026-05-26",
};

type TypeFamily =
	| "bool"
	| "integer"
	| "float"
	| "string"
	| "time"
	| "date"
	| "generic"
	| "compound"
	| "pointer-like"
	| "system";

function dt(name: string, family: TypeFamily, oneLiner: string, opts?: {
	details?: string;
	gotchas?: string[];
	examples?: string[];
	aliases?: string[];
}): ReferenceEntry {
	// All data types here are IEC 61131-3 elementary/derived types,
	// shared across both vendors. __UXINT/__XINT/__VECTOR are CODESYS
	// extensions but TwinCAT inherits them too (TwinCAT 3 is CODESYS-V3
	// derived).
	return {
		name,
		kind: "data-type",
		source: SOURCE,
		vendor: "shared",
		oneLiner,
		details: opts?.details,
		gotchas: opts?.gotchas,
		examples: opts?.examples,
		aliases: opts?.aliases,
	};
}

const ENTRIES: ReferenceEntry[] = [
	dt("BOOL", "bool", "1-bit logical type — but allocated as 8 bits in memory. Values: TRUE (1), FALSE (0)."),

	// Integer types
	dt("BYTE", "integer", "Unsigned 8-bit. Range 0..255."),
	dt("WORD", "integer", "Unsigned 16-bit. Range 0..65535."),
	dt("DWORD", "integer", "Unsigned 32-bit. Range 0..4_294_967_295."),
	dt("LWORD", "integer", "Unsigned 64-bit. Range 0..2⁶⁴-1."),
	dt("SINT", "integer", "Signed 8-bit. Range -128..127."),
	dt("USINT", "integer", "Unsigned 8-bit. Range 0..255."),
	dt("INT", "integer", "Signed 16-bit. Range -32_768..32_767."),
	dt("UINT", "integer", "Unsigned 16-bit. Range 0..65_535."),
	dt("DINT", "integer", "Signed 32-bit. Range -2_147_483_648..2_147_483_647."),
	dt("UDINT", "integer", "Unsigned 32-bit. Range 0..4_294_967_295."),
	dt("LINT", "integer", "Signed 64-bit. Range -2⁶³..2⁶³-1."),
	dt("ULINT", "integer", "Unsigned 64-bit. Range 0..2⁶⁴-1."),

	// Float
	dt("REAL", "float", "IEEE 754 single-precision, 32-bit. ~7 significant digits.", {
		gotchas: [
			"Math results depend on target FPU. Bit-exact equality is fragile across controllers.",
			"REAL → integer conversion is undefined behavior if value is out of range.",
		],
	}),
	dt("LREAL", "float", "IEEE 754 double-precision, 64-bit. ~15 significant digits.", {
		gotchas: ["Target may convert LREAL to REAL during compile if hardware lacks 64-bit FPU."],
	}),

	// String
	dt("STRING", "string", "Variable-length 1-byte-per-char string. Default size 80. Single-quoted literals.", {
		gotchas: [
			"Initial value too long → silently truncated from the right.",
			"Library functions ≥ Standard handle ≤ 255 chars; StringUtils handles longer.",
		],
	}),
	dt("WSTRING", "string", "UCS-2 encoded, 2 bytes per character. Double-quoted literals."),

	// Time
	dt("TIME", "time", "32-bit duration in milliseconds. Range T#0MS..T#49D17H2M47S295MS."),
	dt("LTIME", "time", "64-bit duration in nanoseconds. Range LTIME#0NS..LTIME#213503D...615NS."),

	// Date
	dt("DATE", "date", "32-bit date (DWORD-backed). Range D#1970-01-01..D#2106-02-07. Literal: `D#yyyy-MM-dd`."),
	dt("DATE_AND_TIME", "date", "32-bit timestamp (alias: DT). Range DT#1970-1-1-0:0:0..DT#2106-2-7-6:28:15.", {
		aliases: ["DT"],
	}),
	dt("DT", "date", "Shorthand for DATE_AND_TIME. Cannot be used as an identifier name."),
	dt("TIME_OF_DAY", "date", "32-bit time-of-day, ms resolution (alias: TOD). Range TOD#0:0:0..TOD#23:59:59.999.", {
		aliases: ["TOD"],
	}),
	dt("TOD", "date", "Shorthand for TIME_OF_DAY."),
	dt("LDATE", "date", "64-bit date. Range LDATE#1677-09-22..LDATE#2262-04-11."),
	dt("LDATE_AND_TIME", "date", "64-bit timestamp (alias: LDT). Range LDT#1677-9-21-0:12:43.145..LDT#2262-4-11-23:47:16.854775807.", {
		aliases: ["LDT"],
	}),
	dt("LDT", "date", "Shorthand for LDATE_AND_TIME."),
	dt("LTIME_OF_DAY", "date", "64-bit time-of-day, ns resolution (alias: LTOD). Range LTOD#0:0:0..LTOD#23:59:59.999999999.", {
		aliases: ["LTOD"],
	}),
	dt("LTOD", "date", "Shorthand for LTIME_OF_DAY."),

	// Generic
	dt("ANY", "generic", "Generic input type for functions/methods accepting arbitrary types. Accessed as a system struct of {typeclass, pvalue, diSize}."),
	dt("ANY_NUM", "generic", "Generic numeric (integer + REAL/LREAL)."),
	dt("ANY_INT", "generic", "Generic integer family."),
	dt("ANY_REAL", "generic", "Generic float (REAL + LREAL)."),
	dt("ANY_BIT", "generic", "Generic bit-string (BYTE/WORD/DWORD/LWORD/BIT)."),
	dt("ANY_STRING", "generic", "Generic string (STRING + WSTRING)."),
	dt("ANY_DATE", "generic", "Generic date/time family."),
	dt("ANY_DERIVED", "generic", "Generic user-defined type."),
	dt("ANY_ELEMENTARY", "generic", "Generic elementary type."),

	// CODESYS extensions
	dt("BIT", "bool", "1-bit type — only valid inside STRUCT or FB declarations. Successive BIT vars pack into bytes.", {
		gotchas: [
			"NOT in IEC 61131-3 — CODESYS extension.",
			"POINTER TO BIT, REFERENCE TO BIT, ARRAY OF BIT are all forbidden.",
			"Bit access is significantly slower than BOOL access.",
		],
	}),
	dt("__UXINT", "integer", "Platform-portable unsigned integer. Resolves to UDINT on 32-bit targets, ULINT on 64-bit. Right size for pointer-as-integer.", {
		gotchas: ["CODESYS extension, not IEC."],
	}),
	dt("__XINT", "integer", "Platform-portable signed integer. Resolves to DINT on 32-bit, LINT on 64-bit.", {
		gotchas: ["CODESYS extension, not IEC."],
	}),
	dt("__XWORD", "integer", "Platform-portable bit-string. Resolves to DWORD on 32-bit, LWORD on 64-bit.", {
		gotchas: ["CODESYS extension, not IEC."],
	}),

	// Compound
	dt("POINTER", "pointer-like", "POINTER TO <type>. Address of a value at runtime. Dereference with `^`.", {
		gotchas: [
			"POINTER TO BIT — invalid.",
			"Pointer to an I/O input is a write-target error (copy input to a writable var first).",
			"Pointers can become stale after online change. See {attribute 'no_copy'} / 'init_on_onlchange'.",
		],
		examples: ["VAR p : POINTER TO INT; x : INT := 5; END_VAR\np := ADR(x);\nr := p^;"],
	}),
	dt("REFERENCE", "pointer-like", "REFERENCE TO <type>. Auto-dereferenced pointer. `:=` writes through; `REF=` rebinds.", {
		gotchas: [
			"REFERENCE TO BIT, ARRAY/POINTER/REFERENCE TO REFERENCE TO X — all invalid.",
			"Use __ISVALIDREF before dereferencing if binding is uncertain.",
		],
		examples: ["VAR r : REFERENCE TO INT; x, y : INT; END_VAR\nr REF= x;   (* rebind *)\nr := y;     (* write through *)"],
	}),
	dt("ARRAY", "compound", "ARRAY[lower..upper] OF <type>. Multi-dim with commas. Element type can't be BIT or REFERENCE TO X.", {
		examples: ["VAR a : ARRAY[0..9] OF INT := [0,10,20,30,40,50,60,70,80,90]; END_VAR"],
	}),
	dt("OF", "compound", "Part of ARRAY OF / POINTER TO / REFERENCE TO syntax."),

	// System
	dt("__VECTOR", "system", "SIMD vector type. `__VECTOR[size] OF REAL/LREAL`. Native on x86+SSE2, ARM64+NEON; emulated elsewhere.", {
		gotchas: ["size must be 1..8.", "element type must be REAL or LREAL."],
	}),
	dt("VERSION", "system", "Semver struct auto-generated for projects/libraries: {uiMajor, uiMinor, uiServicePack, uiPatch}."),
];

export const DATA_TYPES = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

for (const e of ENTRIES) {
	if (e.aliases !== undefined) {
		for (const alias of e.aliases) {
			DATA_TYPES.set(alias.toLowerCase(), e);
		}
	}
}
