/**
 * Arithmetic result types — the one home of "what type does this operation compute in". Two views, named apart
 * because they differ on purpose:
 *   - RUN-TIME types (`commonType`, `promoteForRuntime`) are what the program computes in — the transpiler's rules,
 *     measured by the execution oracle (conformance);
 *   - CHECKED types (`checkedNegationType`) are what the compiler's messages name — the analyzer's rules, measured by
 *     conformance fixtures. `-sint` computes in DINT but is reported as INT.
 * `exptResultType` and `temporalResultType` are the same in both views.
 */
import { canonicalElem, elementaryType, isDatetime, isDuration, type ElementaryType } from "./elementary.js"
import { elementaryRef, elemOf, UNKNOWN, type Type } from "./type.js"

/**
 * The run-time type two operands meet at — numeric widening over the table's rank. Non-numeric operands (BOOL, STRING,
 * TIME) have no lattice: they meet only with their own type.
 */
export function commonType(a: Type, b: Type): Type {
  const ea = elemOf(a)
  const eb = elemOf(b)
  if (ea === undefined || eb === undefined) return UNKNOWN
  // TWO STRINGS MEET AT THE WIDER CAPACITY, not at the left one. `MAX(aStringOf2, aStringOf8)` answers 'abc' and
  // `LEN` says 3 whichever operand is written first (conformance `strord_capacity_shorter_first`, `_longer_first`),
  // so keeping the left type cut the answer back to two characters — a wrong value, not a refusal.
  if (ea.name === eb.name && ea.family === "string" && a.kind === "elementary" && b.kind === "elementary")
    return (a.length ?? 0) >= (b.length ?? 0) ? a : b
  if (ea.name === eb.name) return a
  if (ea.rank === undefined || eb.rank === undefined) return UNKNOWN
  // REAL absorbs any integer; otherwise the wider rank wins.
  if (ea.family === "real") return eb.family === "real" ? (ea.rank >= eb.rank ? a : b) : a
  if (eb.family === "real") return b
  // At the same width the SIGNED type wins, on either side: DINT -1 and UDINT 0 sum to -1 and compare -1 < 0 in both
  // orders, LINT/ULINT likewise (conformance `same_width_mixed_sign_order`) — and not by value, UDINT 4294967295 = DINT -1
  // (`signed_unsigned_comparison`). This let the left operand win, so `u > d` compared in UDINT.
  if (ea.rank === eb.rank) return eb.signed && !ea.signed ? b : a
  return ea.rank > eb.rank ? a : b
}

/**
 * THE CHECKED MEET OF TWO OPERANDS — the type the COMPILER'S MESSAGE names for `a <op> b`, which is not the type the
 * operation computes in. `arithmeticWidth` below is the run-time story (anything under 32 bits computes in DINT);
 * this is what CODESYS calls the result when it has to name it.
 *
 * Measured pair by pair, 2026-09-18 — `fixtures/operators/mixed-type.ts` assigns `a <op> b` into a STRING so the
 * compiler must name what it arrived at. Seventy pairs, and they reduce to two lines:
 *
 *   A REAL WINS AS IT IS.          LINT + REAL is REAL, not LREAL, even though a LINT has more bits than a REAL has
 *                                  mantissa. DINT + LREAL is LREAL. REAL + LREAL is LREAL.
 *   OTHERWISE IT IS AN INTEGER     of the widest operand's width, SIGNED if either operand is signed. Never a bit
 *                                  string and never a BOOL: `BYTE + BYTE` is USINT, `BYTE + WORD` is UINT,
 *                                  `DWORD + SINT` is DINT — one narrow signed operand makes the whole thing signed —
 *                                  and `BOOL + INT` is INT.
 *
 * `BYTE + BYTE` being USINT is the one nobody would have guessed, and it is why this cannot be "same type wins".
 *
 * Returns undefined for every pair the recordings do not cover — two BOOLs, a duration, a date, a string — because a
 * meet inferred there would be this function's opinion rather than the vendor's.
 */
export function checkedMeetType(a: Type, b: Type): Type | undefined {
  const ea = elemOf(a)
  const eb = elemOf(b)
  if (ea === undefined || eb === undefined) return undefined
  const known = (e: ElementaryType): boolean =>
    e.family === "int" || e.family === "bitstring" || e.family === "real" || e.family === "bool"
  if (!known(ea) || !known(eb)) return undefined
  if (ea.family === "real" || eb.family === "real") {
    if (ea.family === "real" && eb.family === "real") return ea.bits >= eb.bits ? a : b
    return ea.family === "real" ? a : b
  }
  // A pair of BOOLs is not measured — `TRUE + TRUE` was never asked — so it keeps the old silence.
  if (ea.family === "bool" && eb.family === "bool") return undefined
  const bits = Math.max(ea.bits, eb.bits)
  const signed = ea.signed === true || eb.signed === true
  const order = signed ? ["SINT", "INT", "DINT", "LINT"] : ["USINT", "UINT", "UDINT", "ULINT"]
  const name = bits <= 8 ? order[0] : bits <= 16 ? order[1] : bits <= 32 ? order[2] : order[3]
  return elementaryRef(name!)
}

/**
 * Run-time integer promotion: an integer or bit string narrower than 32 bits computes in DINT. Measured on CODESYS
 * 3.5.21.40 (conformance `arithmetic_width`): `toInt := si + 1` with `si : SINT := 127` is 128, `toDint := us - 1` with
 * `us : USINT := 0` is -1 (SIGNED DINT, not UDINT), `fromInt := i + 1` with `i : INT := 32767` is 32768 — and
 * `fromDint := di + 1` with `di : DINT` at its max is -2147483648 even into a LINT, so DINT itself is not promoted
 * further. Bit strings follow the SAME rule (conformance `bit_string_arithmetic`): `BYTE 255 + 1` into a WORD is 256, and
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
  if (e === undefined || e.family === "real") return t
  // THE SIGNED INTEGER OF THE OPERAND'S WIDTH, FLOOR 16 BITS — for EVERY elementary type, not just the numeric ones.
  // Measured one type at a time on 2026-09-18 (`uop_neg_*`, which assign into a deliberately wrong destination so the
  // compiler has to name what it inferred). It negates first and complains second: `-aString` is
  // "Cannot convert type 'STRING' to type 'INT'", `-aTime` is DINT, `-anLTime` is LINT, `-aBool` is INT. Two rules
  // were wrong here: `rank === undefined` sent every non-numeric back unchanged, and a 64-bit UNSIGNED operand
  // answered `UNKNOWN` when `-ULINT` and `-LWORD` are plainly LINT.
  return elementaryRef(e.bits <= 16 ? "INT" : e.bits <= 32 ? "DINT" : "LINT")
}

/**
 * EXPT's type: REAL only when BOTH arguments are REAL, LREAL otherwise. Measured twice — by conformance (`cc_expt_*`:
 * `real := EXPT(real, real)` is silent, EXPT(INT, INT), EXPT(REAL, INT) and EXPT(LREAL, REAL) into a REAL warn LREAL →
 * REAL) and by execution (conformance `expt_types`, `expt_mixed_width`: EXPT(REAL 3.0, INT 20) is 3486784401, which
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
