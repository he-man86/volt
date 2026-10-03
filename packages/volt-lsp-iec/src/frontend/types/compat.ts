/**
 * compat — the ONE type-conversion relation (Layer C, C.5). `classifyConversion(lhs, rhs)` is the single
 * owner: it returns HOW a value of type `rhs` converts into a target of type `lhs`, over the rich `Type`,
 * reading only the elementary lattice facts (`family`/`bits`/`signed`/`rank` from `elementary`). The
 * severity/message is the `analysis` layer's job — it maps the returned kind, never re-deciding.
 *
 * `isAssignable` is a thin view over `classifyConversion` (no second rank/sign table).
 * Conservative: `unknown` on either side, or a non-checkable category (struct/FB/composite), classifies as
 * `identity` (no diagnostic) — we'd rather miss a bug than flag valid code (0-FP is the floor).
 *
 * Rules are the IEC 61131-3 hierarchy + the reference compilers' behavior, oracle-calibrated:
 *   - widen (rank up, or same-rank same-sign)             → no diagnostic
 *   - narrow (real→smaller real, e.g. LREAL→REAL)          → WARNING "possible loss of information"
 *   - sign-change (same width, signed↔unsigned)           → WARNING "change of sign"
 *   - incompatible (integer narrowing, isolated mismatch, real→int, …) → ERROR (explicit X_TO_Y required)
 */
import { sameName, type Dialect, type Target } from "../syntax/index.js"
import { aliasElem, elementaryType, inTypeGroup } from "./elementary.js"
import type { ElementaryTypeRef, Type } from "./type.js"
import { isIsolated } from "./predicates.js"

/** How `rhs` converts into `lhs`. `identity` also covers the conservative skips (unknown / non-elementary). */
export type ConversionKind = "identity" | "widen" | "narrow" | "sign-change" | "enum-change" | "incompatible"

/**
 * Classify an implicit conversion of `rhs` → `lhs`. The single source of truth for every conversion decision. `target`
 * decides an integer stored into a pointer (`integerIntoPointer`); without it that pair is unjudged.
 */
export function classifyConversion(lhs0: Type, rhs0: Type, target?: Target): ConversionKind {
  // A REFERENCE converts as what it refers to, on either side (rule DT14, `dt_reference_into_narrower`,
  // `cv_reference_to_other_reference`, `cv_reference_to_pointer`, CODESYS 2026-10-03) — the message still names it as
  // the reference, which is the caller's rendering, not this relation's
  const lhs = lhs0.kind === "reference" ? lhs0.target : lhs0
  const rhs = rhs0.kind === "reference" ? rhs0.target : rhs0
  if (lhs.kind === "unknown" || rhs.kind === "unknown") return "identity" // conservative skip
  if (lhs.kind === "pointer" && rhs.kind === "elementary") return integerIntoPointer(rhs, target)

  // Enum rules. A value of ANOTHER enum converts with the warning "Implicit conversion from one enumeration type (A) to
  // another (B)" (`enum-change`; `cv_enum_into_other_enum`, `unit_enum_extends_enum`, both vendors) — it was refused. An
  // enum converts AS ITS BASE, both ways (`enums.ts` `enumBase`: the written one, else INT): stored into a scalar
  // (`cc_enum_into_*`, `cv_enum_base_*_into_scalars`) and a scalar stored into it (`cv_scalars_into_enum`,
  // `cv_scalars_into_enum_with_base`, CODESYS 2026-10-03: into a plain enum a DINT, a REAL, a BOOL are refused, a UINT
  // taken). An enum without a measured base (a library's) is unjudged but for the isolated families.
  if (lhs.kind === "enum" || rhs.kind === "enum") {
    if (lhs.kind === "enum" && rhs.kind === "enum") return isSameType(lhs, rhs) ? "identity" : "enum-change"
    const scalar = lhs.kind === "enum" ? rhs : lhs
    if (scalar.kind !== "elementary") return "identity"
    const base = lhs.kind === "enum" ? lhs.base : rhs.kind === "enum" ? rhs.base : undefined
    // …but an enum stored into a REAL or an LREAL loses nothing, whatever its base: a DINT, UDINT or LINT base is silent
    // into both (`cv_enum_base_{dint,udint,lint}_into_scalars`), where the base itself would warn about the mantissa
    if (base !== undefined && rhs.kind === "enum" && scalar.elem.family === "real") return "widen"
    if (base !== undefined) return lhs.kind === "enum" ? classifyElementary(base.name, scalar.name) : classifyElementary(scalar.name, base.name)
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
  const l = bitToBool(aliasElem(lName)) // destination
  const r = bitToBool(aliasElem(rName)) // source
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
  if (a.kind === "elementary" && b.kind === "elementary") return aliasElem(a.name) === aliasElem(b.name)
  return a.kind === b.kind && "name" in a && "name" in b && sameName(a.name, b.name)
}

/** IEC assignment compatibility: can a value of type `rhs` be implicitly assigned to a `lhs` target? */
export function isAssignable(lhs: Type, rhs: Type, target?: Target): boolean {
  return classifyConversion(lhs, rhs, target) !== "incompatible"
}

/**
 * AN INTEGER STORED INTO A POINTER (rule CV6, `cv_integers_into_pointer`, `cv_xword_into_pointer`, CODESYS 2026-10-03, on
 * the 64-bit target): a 32-bit integer of either sign is refused ("Cannot convert type 'DWORD' to type 'POINTER TO INT'")
 * — it is the pointer of the OTHER platform; every other integer converts as into the unsigned integer of the pointer's
 * width — BYTE, WORD, UINT, LWORD, ULINT, `__XWORD` silent, INT and LINT a change of sign. A REAL is refused
 * (`dt_pointer_arithmetic_refused`: `p - aReal` converts the REAL into the pointer); the other families are unmeasured.
 * Unjudged where the target is unknown or 32-bit (unmeasured).
 */
function integerIntoPointer(rhs: ElementaryTypeRef, target: Target | undefined): ConversionKind {
  const e = rhs.elem
  if (e.family !== "int" && e.family !== "bitstring") return e.family === "real" ? "incompatible" : "identity"
  if (target === undefined || target.pointerBits !== 64 || e.bits === 1) return "identity"
  if (e.bits === 32) return "incompatible"
  return classifyElementary("ULINT", rhs.name)
}

function bitToBool(name: string): string {
  return name === "BIT" ? "BOOL" : name
}

/**
 * The generic type groups a PARAMETER may be declared of — `ANY` and the ANY_* groups both vendors know as types.
 * `ANY_ELEMENTARY` and `ANY_MAGNITUDE` are no type there ("Unknown type: 'ANY_ELEMENTARY'", `ty_any_elementary_*`,
 * `ty_any_magnitude_*`, frontend-conformance 4.1.3), though `ANY_FAMILIES` names them for the operators' rules.
 */
export const GENERIC_PARAMETER_TYPES: ReadonlySet<string> = new Set(["ANY", "ANY_NUM", "ANY_INT", "ANY_REAL", "ANY_BIT", "ANY_STRING", "ANY_DATE"])

/**
 * Does a parameter declared of the generic `group` take an argument of type `arg` (rule TY14, `ty_any_*`, both vendors
 * 2026-10-03)? By the group's families (`inTypeGroup`) — ANY_NUM refuses a STRING, a BOOL and a TIME, ANY_INT a REAL and
 * takes a WORD, ANY_DATE takes a TOD — with ONE vendor difference: TwinCAT's ANY_BIT refuses a BOOL, which CODESYS's
 * takes. Undefined when unmeasured: a group no parameter may be declared of, or a non-elementary argument (ANY takes a
 * STRUCT, recorded; a STRUCT into the others is not).
 */
export function genericParameterAccepts(group: string, arg: Type, dialect: Dialect | undefined): boolean | undefined {
  const upper = group.toUpperCase()
  if (!GENERIC_PARAMETER_TYPES.has(upper)) return undefined
  if (upper === "ANY") return true
  if (arg.kind !== "elementary") return undefined
  if (upper === "ANY_BIT" && dialect === "twincat" && arg.elem.family === "bool") return false
  return inTypeGroup(upper, arg.elem)
}

/**
 * Does a pointer FIT this elementary target — is a pointer assigned to it silently (C0033 otherwise)? An unsigned integer
 * or bit string at least as wide as the TARGET's pointer, one rule on both vendors (frontend-conformance 4.1.1,
 * `ty_pointer_size_twincat`): on a 64-bit target LWORD, ULINT and `__XWORD` fit and WORD, DWORD, UDINT are refused
 * (CODESYS Control Win V3 x64); on a 32-bit one DWORD and UDINT fit too (TwinCAT CE7). It was a VENDOR split — "CODESYS
 * warns for every elementary target, TwinCAT only below 32 bits" — which was the two recording projects' targets read
 * as vendors. Undefined where the target decides and is unknown (a 32-bit integer, no target); a signed integer never
 * fits (only the unsigned widths are recorded; the rule before 4.1.1).
 */
export function pointerFits(t: ElementaryTypeRef, target: Target | undefined): boolean | undefined {
  if (t.elem.signed || (t.elem.family !== "int" && t.elem.family !== "bitstring")) return false
  if (t.elem.bits >= 64) return true
  if (t.elem.bits < 32) return false
  return target === undefined ? undefined : t.elem.bits >= target.pointerBits
}
