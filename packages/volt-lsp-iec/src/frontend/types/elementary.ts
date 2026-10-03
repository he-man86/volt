/**
 * The IEC 61131-3 / CODESYS elementary type table — the single source of truth for a type's checkable facts:
 * numeric range, bit width, signedness, family, and numeric widening rank. Extracted from
 * `docs/codesys-reference/06-data-types.md` (task 0 of `st-static-typechecker`).
 *
 * Ranges are `bigint` because the 64-bit types (LWORD/LINT/ULINT) exceed JS `number`'s exact integer range;
 * constant evaluation of integers is therefore exact. REAL/LREAL carry no bigint range (they are floating —
 * their magnitude limit is checked as a `number` when needed).
 *
 * The `rank` orders the numeric types (SINT/USINT/BYTE=1 … LREAL=6): implicit widening is allowed up the rank,
 * narrowing is not. It is oracle-calibrated — keep it.
 *
 * The questions asked OF this table live beside it: which family a name is in (`predicates.ts`), what the target makes
 * of the platform integers (`platform.ts`), a conversion's name (`conversion-name.ts`), a literal's type (`literal.ts`),
 * a sizeless string's length (`defaults.ts`).
 */

import { CODESYS_ONLY_TYPE_WORDS } from "../syntax/index.js"

export type TypeFamily = "bool" | "int" | "bitstring" | "real" | "time" | "date" | "string"

export interface ElementaryType {
  name: string // canonical upper-case name
  family: TypeFamily
  bits: number
  signed: boolean
  /** Exact value range for integer + bit-string types (undefined for real/bool/time/date/string). */
  range?: { min: bigint; max: bigint }
  /** Numeric widening rank (int/bit-string/real only); undefined for non-numeric families. */
  rank?: number
  /** Nanoseconds per tick a time or date type counts: TIME and TOD milliseconds, DATE and DT seconds, the L variants
   *  nanoseconds (conformance `time_*`, `date_*`, `ldate_ltod_ldt`). Undefined for every other family. */
  tickNs?: bigint
  /** The integer bits a floating type holds exactly — IEEE-754 single 24, double 53. A wider integer converts with
   *  "possible loss of information". Undefined for every other family. */
  mantissaBits?: number
}

const U = (bits: number): bigint => (1n << BigInt(bits)) - 1n // unsigned max
const S_MIN = (bits: number): bigint => -(1n << BigInt(bits - 1)) // signed min
const S_MAX = (bits: number): bigint => (1n << BigInt(bits - 1)) - 1n // signed max

const T = (
  name: string,
  family: TypeFamily,
  bits: number,
  signed: boolean,
  range?: { min: bigint; max: bigint },
  rank?: number,
): ElementaryType => ({ name, family, bits, signed, range, rank })

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
      { ...T("REAL", "real", 32, true, undefined, 5), mantissaBits: 24 },
      { ...T("LREAL", "real", 64, true, undefined, 6), mantissaBits: 53 },
      // Isolated families (no cross-family implicit conversion).
      { ...T("TIME", "time", 32, false), tickNs: 1_000_000n },
      { ...T("LTIME", "time", 64, false), tickNs: 1n },
      { ...T("DATE", "date", 32, false), tickNs: 1_000_000_000n },
      { ...T("TOD", "date", 32, false), tickNs: 1_000_000n },
      // 32, not the 64 this said: DT counts SECONDS in 32 bits — DT#2106-02-07-06:28:15 plus one second wraps to
      // DT#1970-01-01-00:00:00 on CODESYS 3.5.21.40 (conformance `date_width_wrap`). LDT is the 64-bit one.
      { ...T("DT", "date", 32, false), tickNs: 1_000_000_000n },
      { ...T("LDATE", "date", 64, false), tickNs: 1n },
      { ...T("LTOD", "date", 64, false), tickNs: 1n },
      { ...T("LDT", "date", 64, false), tickNs: 1n },
      T("STRING", "string", 8, false),
      T("WSTRING", "string", 16, false),
    ] as ElementaryType[]
  ).map((t) => [t.name, t]),
)

/**
 * IEC abbreviations → their canonical short form, so `TIME_OF_DAY` and `TOD` compare equal. The SINGLE home
 * for this canonicalization (was `ELEM_ABBREV` in type-infer). Keyed upper-case.
 */
export const ELEM_ALIASES: ReadonlyMap<string, string> = new Map([
  ["TIME_OF_DAY", "TOD"],
  ["DATE_AND_TIME", "DT"],
  ["LDATE_AND_TIME", "LDT"],
  ["LTIME_OF_DAY", "LTOD"],
])

/**
 * THE 64-BIT DATE TYPES ARE CODESYS'S ALONE (`syntax/lex/vocabulary.ts` `CODESYS_ONLY_TYPE_WORDS`, which says why). The
 * list lives with the vocabulary since the PARSER asks it too — a refused type name is refused only where the type
 * exists (frontend-conformance 2.8.3) — and resolution refuses the type by it (`resolve.ts` `isDialectType`).
 */
export const CODESYS_ONLY_TYPES: ReadonlySet<string> = CODESYS_ONLY_TYPE_WORDS
/** Canonical short form → the full name, the inverse of ELEM_ALIASES (so the two cannot drift apart). */
const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([...ELEM_ALIASES].map(([full, short]) => [short, full]))

/**
 * The name a compiler message prints for an elementary type. CODESYS spells the abbreviated types out, whatever the
 * declaration wrote: `t1 : TOD := LTOD#12:30:15` is "Cannot convert type 'LTIME_OF_DAY' to type 'TIME_OF_DAY'", a DT
 * is 'DATE_AND_TIME' (conformance `cc_ltod_literal_into_tod`, `cc_ldt_literal_into_dt`); DATE and LDATE print as they
 * are. TwinCAT is not recorded for these yet.
 */
export function elementaryDisplayName(name: string): string {
  const canonical = aliasElem(name)
  return DISPLAY_NAMES.get(canonical) ?? canonical
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
])

/**
 * True when `t` is in the `ANY_*` type group `group`, by family as ANY_FAMILIES lists it (`ANY` holds everything). The one
 * home of those lists — checks used to spell `["int", "bitstring", "real"]` and `STRING || WSTRING` out themselves
 * (consolidate-lsp-structure B2). BIT is `bitstring`, so it is in ANY_INT and ANY_NUM.
 */
export function inTypeGroup(group: string, t: ElementaryType): boolean {
  const families = ANY_FAMILIES.get(group)
  return families !== undefined && (families.length === 0 || families.includes(t.family))
}

/**
 * The canonical short form of an elementary type name — the IEC abbreviations resolved (`TIME_OF_DAY` is `TOD`),
 * upper-cased. NOT the platform integers: what `__XINT` is depends on the target, so a name written in source reaches
 * them only through `platform.ts` `canonicalElem`, with the project's target. A resolved Type never carries one (its
 * name is its facts' name), so this is the spelling every comparison of RESOLVED names reads.
 */
export function aliasElem(name: string): string {
  const u = name.toUpperCase()
  return ELEM_ALIASES.get(u) ?? u
}

/**
 * Facts for an elementary type name (resolves aliases, case-insensitive), or undefined if not elementary — and undefined
 * for a platform integer, whose facts are the target's (`platform.ts` `elementaryTypeOn`).
 */
export function elementaryType(name: string): ElementaryType | undefined {
  return ELEMENTARY_TYPES.get(aliasElem(name))
}
