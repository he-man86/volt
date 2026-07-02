/**
 * IEC 61131-3 standard functions + the ubiquitous CODESYS standard-library string
 * functions. These are global functions that ship with the toolchain — they resolve
 * NOWHERE in a project's symbol table, yet calling them is valid. The unresolved-identifier
 * check consults the reference catalog before flagging, so listing them here stops the
 * false positives (they're `stu.StrConcatA`-style library calls, or bare IEC functions).
 *
 * Scope: string handling (LEN/LEFT/CONCAT/…), array bounds (UPPER_BOUND/LOWER_BOUND),
 * and MOVE. Arithmetic/selection/bit functions are `operators.ts`; conversions are
 * `type-conversion.ts`; standard FBs (TON/CTU/…) are `standard-fbs.ts`.
 */
import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_standard_library_overview.html",
	localFile: "docs/codesys-reference/standard-library.md",
	retrievedAt: "2026-07-02",
};

function fn(name: string, oneLiner: string, vendor: "shared" | "codesys" | "twincat" = "shared"): ReferenceEntry {
	return { name, kind: "standard-function", source: SOURCE, vendor, oneLiner };
}

const ENTRIES: ReferenceEntry[] = [
	// ── IEC 61131-3 string functions ──
	fn("LEN", "Length of a string. `LEN(str) : INT`."),
	fn("LEFT", "Leftmost N chars. `LEFT(str, n)`."),
	fn("RIGHT", "Rightmost N chars. `RIGHT(str, n)`."),
	fn("MID", "N chars from position p. `MID(str, n, p)`."),
	fn("CONCAT", "Concatenate strings. `CONCAT(a, b)`."),
	fn("INSERT", "Insert `b` into `a` at position p. `INSERT(a, b, p)`."),
	fn("DELETE", "Delete N chars from position p. `DELETE(str, n, p)`."),
	fn("REPLACE", "Replace N chars at position p with `b`. `REPLACE(a, b, n, p)`."),
	fn("FIND", "1-based position of `b` in `a`, or 0. `FIND(a, b)`."),
	// ── IEC array-bound + memory ──
	fn("UPPER_BOUND", "Upper index bound of an array dimension. `UPPER_BOUND(arr, dim)`."),
	fn("LOWER_BOUND", "Lower index bound of an array dimension. `LOWER_BOUND(arr, dim)`."),
	fn("MOVE", "Assignment as a function (also enforces execution order in FBD/CFC). `MOVE(in)`."),
	// ── CODESYS standard-library string functions (CAA / SysString — global, ubiquitous) ──
	fn("STRCONCATA", "CODESYS ASCII string concat (Standard/String library).", "codesys"),
	fn("STRCONCATW", "CODESYS wide-string concat.", "codesys"),
	fn("STRLENA", "CODESYS ASCII string length.", "codesys"),
	fn("STRLENW", "CODESYS wide-string length.", "codesys"),
	fn("STRFINDA", "CODESYS ASCII substring search.", "codesys"),
	fn("STRFINDW", "CODESYS wide-string search.", "codesys"),
	fn("STRMIDA", "CODESYS ASCII substring extract.", "codesys"),
	fn("STRMIDW", "CODESYS wide-string substring.", "codesys"),
	fn("STRTRIMA", "CODESYS ASCII string trim.", "codesys"),
	fn("STRTRIMW", "CODESYS wide-string trim.", "codesys"),
	fn("STRCPYA", "CODESYS ASCII string copy.", "codesys"),
	fn("STRCPYW", "CODESYS wide-string copy.", "codesys"),
	fn("STRCMPA", "CODESYS ASCII string compare.", "codesys"),
	fn("STRCMPW", "CODESYS wide-string compare.", "codesys"),
];

export const STANDARD_FUNCTIONS = new Map<string, ReferenceEntry>(ENTRIES.map((e) => [e.name.toLowerCase(), e]));
