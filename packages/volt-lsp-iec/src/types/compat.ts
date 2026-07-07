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

/** Elementary classification, over the lattice facts only. */
function classifyElementary(lName: string, rName: string): ConversionKind {
  // BIT is 1-bit boolean storage — CODESYS treats it as BOOL.
  const l = bitToBool(canonicalElem(lName))
  const r = bitToBool(canonicalElem(rName))
  if (l === r) return "identity"
  // Isolated families (BOOL/STRING/TIME/DATE) accept only themselves.
  if (isIsolated(l) || isIsolated(r)) return "incompatible"

  const lt = elementaryType(l)
  const rt = elementaryType(r)
  const lr = lt?.rank
  const rr = rt?.rank
  if (lt === undefined || rt === undefined || lr === undefined || rr === undefined) return "identity" // not both numeric → skip

  if (rr < lr) return "widen" // narrower rank flows into wider — safe
  if (rr > lr) {
    // Wider → narrower. REAL narrowing (LREAL→REAL) is an implicit WARNING; integer narrowing needs an
    // explicit X_TO_Y and is an ERROR (e.g. `INT := someDINT` → "Cannot convert type 'DINT' to type 'INT'").
    return lt.family === "real" && rt.family === "real" ? "narrow" : "incompatible"
  }
  // Same rank (same width): a signed↔unsigned crossing is a "change of sign" warning; same discipline is safe.
  return lt.signed !== rt.signed ? "sign-change" : "widen"
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
