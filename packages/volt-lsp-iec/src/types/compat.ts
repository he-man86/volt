/**
 * compat — the ONE type-compatibility relation (Layer C, C.5): assignability + narrowing over the
 * rich `Type`. Oracle-calibrated (ports the CODESYS/TwinCAT-verified rules from the legacy assignment
 * + narrowing checks) but expressed on facts, not name strings — it reads `elem.rank`/`family` directly.
 *
 * Conservative: `unknown` on either side, or a non-checkable category (struct/FB/composite), returns
 * `true` (assignable) — we'd rather miss a bug than flag valid code. The `analysis` checks decide
 * WHICH results to surface (e.g. only LREAL→REAL narrowing is currently oracle-emitted).
 */
import { canonicalElem, isIsolated, numericRank } from "./elementary.js"
import type { Type } from "./type.js"

/** IEC assignment compatibility: can a value of type `rhs` be assigned to a target of type `lhs`? */
export function isAssignable(lhs: Type, rhs: Type): boolean {
  if (lhs.kind === "unknown" || rhs.kind === "unknown") return true

  // Enum rules: two different enums are incompatible; enum ↔ scalar is a NUMERIC relation — an enum
  // member is a compile-time integer, freely widened to any numeric (int/bitstring/real, e.g. a corpus
  // `lreal := Enum.Member`). Only the truly isolated families (BOOL/STRING/TIME/DATE) reject it.
  if (lhs.kind === "enum" || rhs.kind === "enum") {
    if (lhs.kind === "enum" && rhs.kind === "enum") return sameName(lhs.name, rhs.name)
    const scalar = lhs.kind === "enum" ? rhs : lhs
    return scalar.kind === "elementary" ? !isIsolated(scalar.name) : true
  }

  if (lhs.kind === "elementary" && rhs.kind === "elementary") return elementaryAssignable(lhs.name, rhs.name)

  // struct / FB / array / pointer / reference — not value-checked here (conservative).
  return true
}

/** Elementary assignability: same type, BIT↔BOOL, REAL↔LREAL, numeric widening up the rank lattice. */
function elementaryAssignable(lName: string, rName: string): boolean {
  // BIT is 1-bit boolean storage — freely compatible with BOOL (CODESYS treats them as such).
  const l = bitToBool(canonicalElem(lName))
  const r = bitToBool(canonicalElem(rName))
  if (l === r) return true
  // REAL ↔ LREAL both ways: LREAL→REAL is a narrowing WARNING (code compiles), not an assignment error.
  if ((l === "REAL" && r === "LREAL") || (l === "LREAL" && r === "REAL")) return true
  // Isolated families (BOOL/STRING/TIME/DATE) accept only themselves.
  if (isIsolated(l) || isIsolated(r)) return false
  const lr = numericRank(l)
  const rr = numericRank(r)
  if (lr === undefined || rr === undefined) return true // not both numeric — don't flag
  return rr <= lr // narrower (or equal) rank flows into wider
}

/**
 * True when assigning `rhs` to `lhs` loses information (a wider numeric into a narrower one, or
 * LREAL→REAL). The relation; the analysis layer gates which narrowings are actually emitted.
 */
export function isNarrowing(lhs: Type, rhs: Type): boolean {
  if (lhs.kind !== "elementary" || rhs.kind !== "elementary") return false
  const lr = numericRank(canonicalElem(lhs.name))
  const rr = numericRank(canonicalElem(rhs.name))
  if (lr === undefined || rr === undefined) return false
  return rr > lr
}

function bitToBool(name: string): string {
  return name === "BIT" ? "BOOL" : name
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
