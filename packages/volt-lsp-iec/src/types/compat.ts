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

  // Enum rules: two different enums are incompatible; enum ↔ scalar is a NUMERIC relation — an enum member is a
  // compile-time integer, freely widened to any numeric (int/bitstring/real). Only isolated families reject it.
  if (lhs.kind === "enum" || rhs.kind === "enum") {
    if (lhs.kind === "enum" && rhs.kind === "enum") return sameName(lhs.name, rhs.name) ? "identity" : "incompatible"
    const scalar = lhs.kind === "enum" ? rhs : lhs
    if (scalar.kind !== "elementary") return "identity"
    return isIsolated(scalar.name) ? "incompatible" : "widen"
  }

  if (lhs.kind !== "elementary" || rhs.kind !== "elementary") return "identity" // struct/FB/array/pointer → skip
  return classifyElementary(lhs.name, rhs.name)
}

// A REAL holds 24 mantissa bits, an LREAL 53 (IEEE-754 single/double). An integer wider than that can't be
// represented exactly, so the compilers warn "possible loss of information" (DINT→REAL, LINT→LREAL, …).
const MANTISSA_BITS: Record<string, number> = { REAL: 24, LREAL: 53 }

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
    // integer → real: safe unless the integer needs more bits than the mantissa holds.
    return src.bits > (MANTISSA_BITS[l] ?? 24) ? "narrow" : "widen"
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
