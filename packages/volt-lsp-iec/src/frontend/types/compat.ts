/**
 * compat — the ONE type-conversion relation (Layer C, C.5). `classifyConversion(lhs, rhs)` is the single
 * owner: it returns HOW a value of type `rhs` converts into a target of type `lhs`, over the rich `Type`,
 * reading only the elementary lattice facts (`family`/`bits`/`signed`/`rank` from `elementary`). The
 * severity/message is the `analysis` layer's job — it maps the returned kind, never re-deciding.
 *
 * `isAssignable` and `isNarrowing` are thin views over `classifyConversion` (no second rank/sign table).
 * Conservative: `unknown` on either side, or a non-checkable category (struct/FB/composite), classifies as
 * `identity` (no diagnostic) — we'd rather miss a bug than flag valid code (0-FP is the floor).
 *
 * Rules are the IEC 61131-3 hierarchy + the reference compilers' behavior, oracle-calibrated:
 *   - widen (rank up, or same-rank same-sign)             → no diagnostic
 *   - narrow (real→smaller real, e.g. LREAL→REAL)          → WARNING "possible loss of information"
 *   - sign-change (same width, signed↔unsigned)           → WARNING "change of sign"
 *   - incompatible (integer narrowing, isolated mismatch, real→int, …) → ERROR (explicit X_TO_Y required)
 */
import { canonicalElem, elementaryType, isIsolated } from "./elementary.js"
import type { Type } from "./type.js"

/** How `rhs` converts into `lhs`. `identity` also covers the conservative skips (unknown / non-elementary). */
export type ConversionKind = "identity" | "widen" | "narrow" | "sign-change" | "incompatible"

/** Classify an implicit conversion of `rhs` → `lhs`. The single source of truth for every conversion decision. */
export function classifyConversion(lhs: Type, rhs: Type): ConversionKind {
  if (lhs.kind === "unknown" || rhs.kind === "unknown") return "identity" // conservative skip

  // Enum rules: two different enums are incompatible. An enum VALUE stored into a scalar converts as its base type —
  // measured for an enum without one, which is INT (conformance `cc_enum_into_*`): silent into INT/DINT/LINT/REAL/LREAL,
  // "Cannot convert" into SINT/USINT/BYTE, "change of sign" into UINT/UDINT/WORD/DWORD. This used to widen into every
  // numeric type. A scalar into an enum, and an explicit base type, are unmeasured: only isolated families reject them.
  if (lhs.kind === "enum" || rhs.kind === "enum") {
    if (lhs.kind === "enum" && rhs.kind === "enum") return isSameType(lhs, rhs) ? "identity" : "incompatible"
    const scalar = lhs.kind === "enum" ? rhs : lhs
    if (scalar.kind !== "elementary") return "identity"
    if (rhs.kind === "enum" && rhs.base !== undefined) return classifyElementary(scalar.name, rhs.base.name)
    return isIsolated(scalar.name) ? "incompatible" : "widen"
  }

  if (lhs.kind !== "elementary" || rhs.kind !== "elementary") return "identity" // struct/FB/array/pointer → skip
  return classifyElementary(lhs.name, rhs.name)
}

/**
 * Elementary classification, over the lattice facts only — every rule is calibrated against the live compilers
 * by `scripts/conversion-matrix.ts` (the full N×N numeric matrix agrees severity-for-severity).
 */
function classifyElementary(lName: string, rName: string): ConversionKind {
  // BIT is 1-bit boolean storage — CODESYS treats it as BOOL.
  const l = bitToBool(canonicalElem(lName)) // destination
  const r = bitToBool(canonicalElem(rName)) // source
  if (l === r) return "identity"
  // Isolated families (BOOL/STRING/TIME/DATE) accept only themselves.
  if (isIsolated(l) || isIsolated(r)) return "incompatible"

  const dst = elementaryType(l)
  const src = elementaryType(r)
  if (dst === undefined || src === undefined || dst.rank === undefined || src.rank === undefined) return "identity" // not both numeric → skip

  const dstReal = dst.family === "real"
  const srcReal = src.family === "real"

  if (dstReal) {
    // real → real: wider mantissa is safe, LREAL→REAL loses precision (a WARNING).
    if (srcReal) return src.rank <= dst.rank ? "widen" : "narrow"
    // integer → real: safe unless the integer needs more bits than the mantissa holds (DINT→REAL, LINT→LREAL warn).
    return dst.mantissaBits !== undefined && src.bits > dst.mantissaBits ? "narrow" : "widen"
  }
  // real → integer needs an explicit X_TO_Y — an ERROR (e.g. `INT := someREAL`).
  if (srcReal) return "incompatible"

  // Both integer/bitstring. A wider source narrows into the destination → an ERROR (explicit conversion needed).
  if (src.rank > dst.rank) return "incompatible"
  // The source fits width-wise. A signedness crossing is a "change of sign" WARNING — but only when the target
  // can't represent the source's range: signed→unsigned always can go negative; unsigned→signed only clashes at
  // the SAME width (a wider signed target holds every unsigned value). Same discipline → safe widen.
  if (src.signed !== dst.signed) {
    if (src.signed) return "sign-change" // signed → unsigned: negatives don't fit, any width
    return src.rank === dst.rank ? "sign-change" : "widen" // unsigned → signed: only same-width overflows
  }
  return "widen"
}

/**
 * The same type: the same kind and name — case-insensitively, as IEC names are, and an elementary name through its alias
 * (`TIME_OF_DAY` is `TOD`). A type without a name (array, pointer, unknown) is never "the same" here. The comparison
 * check compared enum names case-sensitively, so `a : E_Mode` against `b : e_mode` was two different enums.
 */
export function isSameType(a: Type, b: Type): boolean {
  if (a.kind === "elementary" && b.kind === "elementary") return canonicalElem(a.name) === canonicalElem(b.name)
  return a.kind === b.kind && "name" in a && "name" in b && sameName(a.name, b.name)
}

/** IEC assignment compatibility: can a value of type `rhs` be implicitly assigned to a `lhs` target? */
export function isAssignable(lhs: Type, rhs: Type): boolean {
  return classifyConversion(lhs, rhs) !== "incompatible"
}

/** True when assigning `rhs` to `lhs` is an implicit lossy narrowing (a WARNING, not an error) — e.g. LREAL→REAL. */
export function isNarrowing(lhs: Type, rhs: Type): boolean {
  return classifyConversion(lhs, rhs) === "narrow"
}

function bitToBool(name: string): string {
  return name === "BIT" ? "BOOL" : name
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
