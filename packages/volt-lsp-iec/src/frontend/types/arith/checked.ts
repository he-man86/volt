/**
 * CHECKED ARITHMETIC TYPES — what the compiler's messages NAME for an operation, which is not always what it computes
 * in (`runtime.ts`): the analyzer's rules, measured by conformance fixtures.
 */
import { elementaryType, type ElementaryType } from "../elementary.js"
import { elementaryRef, elemOf, type Type } from "../type.js"
import { integerOfWidth } from "../width.js"

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
  return elementaryRef(integerOfWidth(Math.max(ea.bits, eb.bits), ea.signed === true || eb.signed === true).name)
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
  return elementaryRef(integerOfWidth(Math.max(e.bits, 16), true).name)
}
