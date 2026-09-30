/**
 * RUN-TIME ARITHMETIC TYPES — what the program computes in: the transpiler's rules, measured by the execution oracle.
 * What the compiler's MESSAGES name is `checked.ts` (they differ on purpose: `-sint` computes in DINT but is reported
 * as INT); date/time arithmetic, the same in both views, is `temporal.ts`; EXPT's, also the same in both, is a
 * built-in's (`builtins.ts`).
 */
import { elementaryRef, elemOf, UNKNOWN, type Type } from "../type.js"
import { integerOfWidth } from "../width.js"

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
  // At DIFFERENT widths a signed operand still makes the meet signed, at the WIDER width: ULINT 6 / SINT -2 is -3,
  // DWORD 0 > INT -2 is TRUE and MIN(UDINT 7, INT -2) is -2 (conformance `meet_mixed_sign_wider_unsigned`) — the
  // checked meet's rule (`checkedMeetType`). Letting the wider unsigned type win computed all three in it.
  const wider = ea.rank > eb.rank ? ea : eb
  if (!wider.signed && (ea.signed === true || eb.signed === true)) return elementaryRef(integerOfWidth(wider.bits, true).name)
  return ea.rank > eb.rank ? a : b
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
