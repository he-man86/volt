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

/**
 * THE TYPE AN UNTYPED LITERAL TAKES BESIDE A BIT OPERATOR'S (AND, OR, XOR) INTEGER OPERAND: the smallest UNSIGNED integer at
 * least the operand's width that holds it — never the next SIGNED integer, as at `+`. Measured into STRINGs, CODESYS
 * 2026-10-03 (`ar_bitwise_literal_beyond_width`; `cc_bitwise_sint_and_literal` builds with one warning): `si AND 255` and
 * `255 AND si` are USINT, `i AND 16#FF00` UINT, `d OR 16#80000000` UDINT, each with the signed operand's conversion into
 * it, and `si AND 300` is UINT with "SINT to UINT" — the operation computes at the literal's wider width
 * (`operators.ts` `bitwiseLiteralResultType`). The same beside an UNSIGNED or bit-string operand: `us AND 300`, `300 OR us`
 * and `bt AND 300` are UINT, `w AND 16#1FFFF` UDINT, and stored back into the operand they are refused
 * (`ar_bitwise_literal_unsigned_or_negative`, `_stores`, both vendors 2026-10-03). A NEGATIVE literal beside a signed
 * operand that holds it is that operand's type — `si AND -1` and `-1 AND si` are USINT after the meet, `i XOR -1` UINT
 * (the same fixtures; the literal still converts from its OWN type, SINT, which `narrowing` warns). Beside an unsigned
 * one, or beyond the signed width, undefined (not asked). Undefined beside anything that is no integer or bit string.
 */
export function bitwiseLiteralOperandType(value: bigint | number, other: Type): Type | undefined {
  const e = elemOf(other)
  if (typeof value !== "bigint" || e === undefined || (e.family !== "int" && e.family !== "bitstring") || e.rank === undefined) return undefined
  const signed = e.signed === true
  if (value < 0n) {
    const own = integerOfWidth(e.bits, true)
    return signed && own.range !== undefined && value >= own.range.min ? other : undefined
  }
  for (const bits of [8, 16, 32, 64].filter((b) => b >= e.bits)) {
    const view = integerOfWidth(bits, false)
    if (view.range !== undefined && value <= view.range.max) return elementaryRef(view.name)
  }
  return undefined
}

/**
 * THE TYPE AN UNTYPED LITERAL OPERAND TAKES BESIDE A TYPED ONE — what makes `i + 1` an INT. Measured into a STRING, either
 * side, on both vendors (`ar_int_literal_operand_types`, `ar_real_literal_operand_types`, 2026-10-03, rules AR1/AR7):
 *
 *   AN INTEGER BESIDE AN INTEGER   the neighbour's integer when it holds the value — a bit string's is the unsigned
 *                                  integer of its width, so `aByte + 1` is USINT like `aByte + aByte` — else the smallest
 *                                  integer of that signedness that does: `aSint + 200` INT, `aUsint + 300` UINT,
 *                                  `aUint + 70000` UDINT, `anInt + 70000` DINT. The meet (`checkedMeetType`) then names it.
 *   BESIDE A REAL                  an integer meets into the real (`aReal + 1` REAL, `anLreal + 1` LREAL).
 *   A REAL LITERAL                 REAL beside a REAL (`aReal + 1.5` REAL), LREAL beside an LREAL. Beside an INTEGER it
 *                                  takes its type from where the operation is STORED: into a STRING `anInt + 1.5` is
 *                                  named LREAL, into a REAL it is silent (`division_with_a_real_operand`, `int7 / 2.0`) —
 *                                  a context an operation's own type does not have, so it is undefined here.
 *
 * `value` is the literal's (its sign applied); undefined when unmeasured: a negative literal beside an unsigned integer,
 * or any neighbour that is no integer, bit string or real.
 */
export function literalOperandType(value: bigint | number, other: Type): Type | undefined {
  const e = elemOf(other)
  if (e === undefined) return undefined
  if (typeof value === "number") return e.family === "real" ? other : undefined
  if (e.family === "real") return other
  if ((e.family !== "int" && e.family !== "bitstring") || e.rank === undefined) return undefined
  const signed = e.signed === true
  if (!signed && value < 0n) return undefined
  for (const bits of [8, 16, 32, 64].filter((b) => b >= e.bits)) {
    const view = integerOfWidth(bits, signed)
    if (view.range !== undefined && value >= view.range.min && value <= view.range.max) return elementaryRef(view.name)
  }
  return undefined
}
