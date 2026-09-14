/**
 * Arithmetic result types — the one home of "what type does this operation compute in". Two views, named apart
 * because they differ on purpose:
 *   - RUN-TIME types (`commonType`, `promoteForRuntime`) are what the program computes in — the transpiler's rules,
 *     measured by the execution oracle (test/exec);
 *   - CHECKED types (`checkedNegationType`) are what the compiler's messages name — the analyzer's rules, measured by
 *     conformance fixtures. `-sint` computes in DINT but is reported as INT.
 * `exptResultType` and `temporalResultType` are the same in both views.
 */
import { canonicalElem, elementaryType, isDatetime, isDuration } from "./elementary.js"
import { elementaryRef, elemOf, UNKNOWN, type Type } from "./type.js"

/**
 * The run-time type two operands meet at — numeric widening over the table's rank. Non-numeric operands (BOOL, STRING,
 * TIME) have no lattice: they meet only with their own type.
 */
export function commonType(a: Type, b: Type): Type {
  const ea = elemOf(a)
  const eb = elemOf(b)
  if (ea === undefined || eb === undefined) return UNKNOWN
  if (ea.name === eb.name) return a
  if (ea.rank === undefined || eb.rank === undefined) return UNKNOWN
  // REAL absorbs any integer; otherwise the wider rank wins.
  if (ea.family === "real") return eb.family === "real" ? (ea.rank >= eb.rank ? a : b) : a
  if (eb.family === "real") return b
  // At the same width the SIGNED type wins, on either side: DINT -1 and UDINT 0 sum to -1 and compare -1 < 0 in both
  // orders, LINT/ULINT likewise (test/exec `same_width_mixed_sign_order`) — and not by value, UDINT 4294967295 = DINT -1
  // (`signed_unsigned_comparison`). This let the left operand win, so `u > d` compared in UDINT.
  if (ea.rank === eb.rank) return eb.signed && !ea.signed ? b : a
  return ea.rank > eb.rank ? a : b
}

/**
 * Run-time integer promotion: an integer or bit string narrower than 32 bits computes in DINT. Measured on CODESYS
 * 3.5.21.40 (test/exec `arithmetic_width`): `toInt := si + 1` with `si : SINT := 127` is 128, `toDint := us - 1` with
 * `us : USINT := 0` is -1 (SIGNED DINT, not UDINT), `fromInt := i + 1` with `i : INT := 32767` is 32768 — and
 * `fromDint := di + 1` with `di : DINT` at its max is -2147483648 even into a LINT, so DINT itself is not promoted
 * further. Bit strings follow the SAME rule (test/exec `bit_string_arithmetic`): `BYTE 255 + 1` into a WORD is 256, and
 * `BYTE 0 - 1` / `WORD 0 - 1` into a DINT are -1. BIT has no rank and is never an arithmetic operand, so it is excluded.
 */
export function promoteForRuntime(t: Type): Type {
  const e = elemOf(t)
  const integral = e !== undefined && (e.family === "int" || e.family === "bitstring") && e.rank !== undefined
  return integral && e.bits < 32 ? elementaryRef("DINT") : t
}

/**
 * The type a unary minus is REPORTED in: the signed type of the operand's width, at least 16 bits. Measured live on
 * CODESYS SP21 (conformance `cc_neg_*`): SINT, USINT and BYTE negate to INT — `sint := -sint` is "Cannot convert type
 * 'INT' to type 'SINT'" — UINT and WORD to INT and UDINT to DINT (each with a "change of sign" on the operand, which the
 * narrowing check emits); INT, DINT and LINT keep their type. A 64-bit UNSIGNED operand was not measured, so it stays
 * UNKNOWN — silence, never a guessed diagnostic.
 */
export function checkedNegationType(t: Type): Type {
  if (t.kind !== "elementary") return t
  const e = elementaryType(t.name)
  if (e === undefined || e.rank === undefined || (e.family !== "int" && e.family !== "bitstring")) return t
  if (e.bits > 32 && !e.signed) return UNKNOWN
  return elementaryRef(e.bits <= 16 ? "INT" : e.bits <= 32 ? "DINT" : "LINT")
}

/**
 * EXPT's type: REAL only when BOTH arguments are REAL, LREAL otherwise. Measured twice — by conformance (`cc_expt_*`:
 * `real := EXPT(real, real)` is silent, EXPT(INT, INT), EXPT(REAL, INT) and EXPT(LREAL, REAL) into a REAL warn LREAL →
 * REAL) and by execution (test/exec `expt_types`, `expt_mixed_width`: EXPT(REAL 3.0, INT 20) is 3486784401, which
 * float32 cannot hold).
 */
export function exptResultType(base: Type, exponent: Type): Type {
  const real32 = (t: Type): boolean => elemOf(t)?.family === "real" && elemOf(t)?.bits === 32
  return real32(base) && real32(exponent) ? elementaryRef("REAL") : elementaryRef("LREAL")
}

/** The duration a date type's difference is: LTIME for a 64-bit date type, TIME otherwise. */
export function durationFor(dateName: string): string {
  return elementaryType(dateName)?.bits === 64 ? "LTIME" : "TIME"
}

/**
 * Date/time arithmetic's result type name, or undefined when the operands are not a temporal pair: a date − the same
 * date is its duration (`durationFor`), a date ± a duration and a duration + a date are the date.
 */
export function temporalResultType(op: "+" | "-", left: string, right: string): string | undefined {
  const [l, r] = [canonicalElem(left), canonicalElem(right)]
  if (op === "-") {
    if (isDatetime(l) && l === r) return durationFor(l)
    if (isDatetime(l) && isDuration(r)) return l
  }
  if (op === "+") {
    if (isDatetime(l) && isDuration(r)) return l
    if (isDuration(l) && isDatetime(r)) return r
  }
  return undefined
}
