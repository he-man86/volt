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

/** Largest finite magnitude for the floating types (doc 06), for REAL/LREAL overflow of a constant. */
export const REAL_MAX_MAGNITUDE: ReadonlyMap<string, number> = new Map([
  ["REAL", 3.402823e38],
  ["LREAL", 1.7976931348623157e308],
])

/** The characters a sizeless STRING or WSTRING holds (conformance `string_default_length`, `wstring_basic`). */
export const DEFAULT_STRING_LENGTH = 80

/** The type an untyped real literal takes — `i := 1.5` is "Cannot convert type 'LREAL' to type 'INT'" (conformance
 *  `cc_init_real_into_int`), an enum member `(A := 2.5)` "Type 'LREAL' can not be converted". */
export const REAL_LITERAL_TYPE = "LREAL"

/** The widest range any IEC integer type holds, [LINT min .. ULINT max]: an untyped integer outside it has no type. */
export const ANY_INT_RANGE: { readonly min: bigint; readonly max: bigint } = { min: S_MIN(64), max: U(64) }

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
 * THE 64-BIT DATE TYPES ARE CODESYS'S ALONE. TwinCAT has `LTIME` and does NOT have `LDATE`, `LTOD`/
 * `LTIME_OF_DAY` or `LDT`/`LDATE_AND_TIME`: it answers "Unknown type: 'LDATE'" for a declaration, and
 * "Identifier 'DATE_TO_LDATE' not defined" for the conversions that would carry them (39 messages across 13
 * fixtures in its recording, and none in CODESYS's — 2026-09-20).
 *
 * Kept here rather than in `syntax/tokens.ts` with the CODESYS-only KEYWORDS, because these are type NAMES:
 * the lexer is right to treat them the same either way, and it is resolution that has to refuse them.
 */
export const CODESYS_ONLY_TYPES: ReadonlySet<string> = new Set([
  "LDATE",
  "LTOD",
  "LTIME_OF_DAY",
  "LDT",
  "LDATE_AND_TIME",
])
/**
 * THE PLATFORM-PORTABLE INTEGERS, which are a different kind of alias: the COMPILER resolves them by target width,
 * and by the time it prints a message the alias is gone. They are in the vendor's Elementary group and were missing
 * from this table entirely, so `elementaryType("__XINT")` was undefined and every check gating on `checkable()` said
 * nothing about them.
 *
 * Measured on the exec oracle (`types/platform-integers.ts`, 2026-09-19) — every message names the resolved type and
 * `SIZEOF` is 8 for all three:
 *
 *   __XINT   -> LINT     `a : __XINT` into a DINT is "Cannot convert type 'LINT' to type 'DINT'"
 *   __UXINT  -> ULINT
 *   __XWORD  -> LWORD    and `__XWORD + DINT` is LINT, exactly as the measured meet lattice says
 *
 * THAT IS A 64-BIT TARGET, AND THE TABLE BELOW ASSERTS IT UNCONDITIONALLY. This said "Volt has no such device to
 * record against, so a 32-bit project is an unrecorded case rather than a wrong one". **That premise is false as
 * of 2026-09-20**: the TwinCAT fixture project is a 32-bit target, and re-recording the whole suite against it
 * measured exactly the predicted other half —
 *
 *   __XINT -> DINT, __UXINT -> UDINT, __XWORD -> DWORD
 *
 * across all 18 `plat_*` cells, consistently. So the width is a property of the TARGET, it is now measured on
 * both sides, and this table is right for one of them and wrong for the other.
 *
 * IT IS NOT A VENDOR PROPERTY, and must not become a vendor branch. TwinCAT ships x64 runtimes and CODESYS ships
 * 32-bit PLCs; keying it on the vendor would be right for these two fixture projects and wrong in principle. What
 * decides it is the DEVICE: the exec oracle's is `CODESYS Control Win V3 x64` and says so in its name, while the
 * TwinCAT project carries no marker at all and takes TwinCAT's 32-bit default.
 *
 * LEFT AS IS, DELIBERATELY, because the alternative is a guess of a different shape. Declining to resolve them
 * would silence a message that is CORRECT on every 64-bit project, and the LSP analyses files without a device in
 * reach — the conformance replay has no workspace at all. Exposure today is nil and measured: all 1833 uses in
 * the corpus (`__XWORD` 1570, `__UXINT` 193, `__XINT` 70) are inside `Library Manager/`, which the server skips,
 * so no corpus file is analysed against this assumption. The 9 `plat_*` false positives against TwinCAT are the
 * whole of the damage, and they are on the triage list with this note rather than papered over.
 *
 * The fix, when it comes, is to take the width from the project's target and to say NOTHING when that is not
 * knowable — one rule, no vendor branch. `openspec/changes/twincat-conformance-parity` carries the decision.
 *
 * Kept out of `ELEM_ALIASES` on purpose: that map's inverse drives `elementaryDisplayName`, and these must never
 * print as themselves.
 */
export const PLATFORM_ALIASES: ReadonlyMap<string, string> = new Map([
  ["__XINT", "LINT"],
  ["__UXINT", "ULINT"],
  ["__XWORD", "LWORD"],
])

/** Canonical short-form name for an elementary type (resolves the aliases above). Upper-cases. */
export function canonicalElem(name: string): string {
  const u = name.toUpperCase()
  return ELEM_ALIASES.get(u) ?? PLATFORM_ALIASES.get(u) ?? u
}

/** Canonical short form → the full name, the inverse of ELEM_ALIASES (so the two cannot drift apart). */
const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([...ELEM_ALIASES].map(([full, short]) => [short, full]))

/**
 * The name a compiler message prints for an elementary type. CODESYS spells the abbreviated types out, whatever the
 * declaration wrote: `t1 : TOD := LTOD#12:30:15` is "Cannot convert type 'LTIME_OF_DAY' to type 'TIME_OF_DAY'", a DT
 * is 'DATE_AND_TIME' (conformance `cc_ltod_literal_into_tod`, `cc_ldt_literal_into_dt`); DATE and LDATE print as they
 * are. TwinCAT is not recorded for these yet.
 */
export function elementaryDisplayName(name: string): string {
  const canonical = canonicalElem(name)
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
 * The ANY families as a CONVERSION FUNCTION spells them — `ANY_TO_DWORD`, exactly as the type group is spelled.
 *
 * The UNDERSCORELESS spelling (`ANYNUM_TO_WORD`) was accepted here for a while, because the corpus writes it 80
 * times. It was measured on SP21 and CODESYS has no such function (`cs_anynum_to_conversions`):
 *
 *   Identifier 'ANYNUM_TO_WORD' not defined
 *
 * All 80 corpus uses sit inside materialized `Library Manager/` files — CAA CiA405's own enum initializers, not
 * user code — so they were never evidence that the compiler accepts it in a POU. A count is not a measurement.
 */
const ANY_CONVERSION_PREFIXES: ReadonlySet<string> = new Set(ANY_FAMILIES.keys())

/**
 * True when `t` is in the `ANY_*` type group `group`, by family as ANY_FAMILIES lists it (`ANY` holds everything). The one
 * home of those lists — checks used to spell `["int", "bitstring", "real"]` and `STRING || WSTRING` out themselves
 * (consolidate-lsp-structure B2). BIT is `bitstring`, so it is in ANY_INT and ANY_NUM.
 */
export function inTypeGroup(group: string, t: ElementaryType): boolean {
  const families = ANY_FAMILIES.get(group)
  return families !== undefined && (families.length === 0 || families.includes(t.family))
}

/** The integer types a literal can take, narrowest first, a signed type before the unsigned one of its width. */
const LITERAL_INTEGER_ORDER = ["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT"]

/**
 * The type CODESYS gives an untyped integer literal: the narrowest of SINT, USINT, INT, UINT, DINT, UDINT, LINT, ULINT
 * that holds the value — 127 is SINT, 128 USINT, 300 INT, 40000 UINT, 70000 DINT, -129 INT, 3000000000 UDINT (conformance
 * `overflow_*`, `cc_literal_*`). Undefined past ULINT. The one home of that order: checking and the transpiler both use it.
 */
export function integerLiteralType(value: bigint): ElementaryType | undefined {
  for (const name of LITERAL_INTEGER_ORDER) {
    const t = ELEMENTARY_TYPES.get(name)!
    if (value >= t.range!.min && value <= t.range!.max) return t
  }
  return undefined
}

/**
 * A conversion operator's name — `INT_TO_REAL`, `TO_STRING` — as its source and target types, or undefined when the name is
 * none. Both sides must be an elementary type spelled as this table spells it: CODESYS defines `TOD_TO_UDINT` but not
 * `TIME_OF_DAY_TO_UDINT` ("Identifier 'TIME_OF_DAY_TO_UDINT' not defined", conformance `cc_conv_spelled_*`), and a project
 * function called `GO_TO_START` is no conversion. The ONE parser — lowering, inference, the checks, identifier resolution
 * and the reference catalog all read a conversion name through it; there were six, and they disagreed.
 */
export function parseConversionName(name: string): { from?: ElementaryType; to: ElementaryType } | undefined {
  // case-insensitive, as every ST name is — `int_to_real` is `INT_TO_REAL` (the test caught a missing `i` here)
  const m = /^(?:([A-Za-z]+(?:_[A-Za-z]+)?)_)?TO_([A-Za-z]+)$/i.exec(name)
  if (m === null) return undefined
  const to = ELEMENTARY_TYPES.get(m[2]!.toUpperCase())
  if (to === undefined) return undefined
  if (m[1] === undefined) return { to }
  // `ANY_TO_INT` names no concrete source — the ANY families stand for "whatever the argument is", exactly as the bare
  // `TO_INT` does, and the corpus writes them 72 times. Unknown here, every one of them was an undefined identifier.
  if (ANY_CONVERSION_PREFIXES.has(m[1].toUpperCase())) return { to }
  const from = ELEMENTARY_TYPES.get(m[1].toUpperCase())
  return from === undefined ? undefined : { from, to }
}

/** Facts for an elementary type name (resolves aliases, case-insensitive), or undefined if not elementary. */
export function elementaryType(name: string): ElementaryType | undefined {
  return ELEMENTARY_TYPES.get(canonicalElem(name))
}

// ─── Derived views — the ONE place each old scattered set is now computed from the table above ───

/** Numeric widening rank (was `NUMERIC_RANK` in check-assignment-types), or undefined for non-numeric. */
export function numericRank(name: string): number | undefined {
  return elementaryType(name)?.rank
}

/** Integer-family names (was `INTEGER_TYPES` in check-binary-operators): int/bit-string with a rank (excludes BIT). */
export function isIntegerType(name: string): boolean {
  const t = elementaryType(name)
  return t !== undefined && t.rank !== undefined && (t.family === "int" || t.family === "bitstring")
}

/** Numeric names (was `NUMERIC_TYPES`): everything with a widening rank (integers + REAL/LREAL). */
export function isNumericType(name: string): boolean {
  return numericRank(name) !== undefined
}

/** Assignment-isolated families — no cross-family implicit conversion (was `ISOLATED`). */
export function isIsolated(name: string): boolean {
  const f = elementaryType(name)?.family
  return f === "bool" || f === "string" || f === "time" || f === "date"
}

/** Date/time (non-duration) family (was `DATETIME_TYPES`). */
export function isDatetime(name: string): boolean {
  return elementaryType(name)?.family === "date"
}

/** Duration family — TIME/LTIME (was `DURATION_TYPES`). */
export function isDuration(name: string): boolean {
  return elementaryType(name)?.family === "time"
}

/** A name the resolver treats as a known primitive (was `type-resolver.ELEMENTARY_TYPES`): an elementary
 *  type, an `ANY_*` generic, or the bare `POINTER` keyword. */
export function isKnownPrimitive(name: string): boolean {
  const u = name.toUpperCase()
  return elementaryType(u) !== undefined || ANY_FAMILIES.has(u) || u === "POINTER"
}
